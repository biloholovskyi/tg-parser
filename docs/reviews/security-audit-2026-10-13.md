# Аудит безопасности — блок 11, алерты (2026-10-13)

Область: незакоммиченные изменения ветки `r-1.5.1` (в задаче указана `r-1.5.0`, фактическая ветка `r-1.5.1`).
Модуль `src/alerts/`, `src/config/alerts.config.ts` и все места вызова: `auth.service.ts`, `session-store.ts`,
`utils/telegram-errors.ts` (`failWith`), `channel.service.ts`, `telegram.service.ts`, `redis-client.ts`,
`redis.module.ts`, `digest.service.ts`, `digest.scheduler.ts`, `process-handlers.ts`, `main.ts`, предикаты
в `src/config/{telegram,api-keys,redis,digest}.config.ts`. Контекст: `docs/plans/block-11-alerts/design.md`,
`risks.md`. Чек-лист: `.claude/rules/refactor-security-audit.md`. `.env` не читался, MTProto-соединения не
открывались. Проверки поведения библиотек выполнены скриптами в scratchpad с поддельными значениями.

Принятые решения пользователя (не находки): `userId` и `username` в алерте о логине (`risks.md`); сессии в
Redis (ADR блока 10); тексты приватных каналов уходят в xAI (блок 10).

## Итог трассировки секретов

Ни один секрет сейчас не доходит до исходящего алерта. Проверено по каждому источнику:

- `sessionString`: в `details` не передаётся ни в одном вызове; `describeError` для RPC-ошибок отдаёт только
  код (`RPCError.message` GramJS 2.26.22 не содержит аргументов запроса); `StringSession` бросает
  `Not a valid string` без значения.
- Телефон, SMS-код, пароль 2FA: `failWith(..., 'Auth', ...)` получает только код RPC или локальные ошибки
  GramJS (`client/auth.js`, `Password.js`) — ни одна не содержит телефон, код или пароль. Алерт о логине
  строится из `Api.auth.Authorization` (`utils/login-identity.ts`), телефона там нет.
- `TELEGRAM_API_HASH`: в ошибки не попадает; `BootConfigReporter` отдаёт только имена переменных.
- Токен бота: `BotError` несёт статус и `description` Telegram, сетевые ошибки сводятся к имени класса
  (`bot-notifier.ts:106-114`); URL с токеном в сообщение не попадает.
- Ключ Grok: `GrokError` несёт статус или фиксированную причину (`grok.client.ts:148-156`).
- `ALERTS_API_KEY`: только в заголовке; `AlertSendError` несёт статус, `timeout` или имя класса;
  `alerts.config.ts:43` логирует только имена переменных. Тестовые значения поддельные.
- URL Redis с паролем: события `error` отдают `error.code ?? error.name` (`redis-client.ts:103`); ошибка
  `repository.save` приходит как `ServiceUnavailableException` с фиксированным текстом; конструктор ioredis на
  кривом URL бросает `TypeError: Invalid URL` / `URIError: URI malformed` без самого URL (проверено).

Остаточный риск сосредоточен в трёх местах: редиректы в `alert-sender.ts`, неполный санитайзер и
необработанный текст сторонних ошибок в нескольких путях.

## CRITICAL

Нет.

## HIGH

Нет.

## MEDIUM

### M1. `sendAlert` следует редиректам и передаёт `X-API-Key` и тело алерта на любой origin; `ALERTS_URL` допускает `http:`

- Файлы: `src/alerts/alert-sender.ts:62-67` (вызов `fetch` без `redirect`), `src/config/alerts.config.ts:13`,
  `:49-59` (`ALLOWED_PROTOCOLS` содержит `http:`, userinfo, query и fragment не отклоняются).
- Проверено на установленном Node: `fetch` с ответом 307 на другой origin повторяет POST с заголовком
  `X-API-Key` и телом без изменений. Спецификация fetch снимает при кросс-доменном редиректе только
  `Authorization`, произвольный заголовок сохраняется.
- Атака: любой, кто может заставить адрес алертов ответить редиректом (захват или смена домена
  TechAdminServer, ошибка прокси, подмена DNS при `http:`), получает `ALERTS_API_KEY` и содержимое алертов
  (`userId`, `username`, имена каналов, тексты ошибок). При `http:` ключ и тело идут открытым текстом при
  каждом запросе.
- Исправление: в `fetch` задать `redirect: 'error'` (редирект становится `AlertSendError`, 4xx-подобный, без
  повтора); в `parseUrl` требовать `https:`, разрешая `http:` только для `localhost` и `*.railway.internal`;
  отклонять адрес с userinfo, query или fragment (сейчас URL с userinfo принимается, а undici отказывается его
  отправлять, и алерты молча не работают с `network error (TypeError)`). Тест: 307 на другой origin не
  доходит до второго сервера.

### M2. Санитайзер — слабая вторая линия защиты: пропускает очевидные имена ключей, форматы секретов и бинарные объекты

- Файл: `src/alerts/alert-sanitizer.ts:17-34`, `:98-120`, `:129-132`.
- Проверено вызовом `buildAlertPayload` с поддельными значениями:
  - Ключи, которые проходят: `encryptionKey`, `privateKey`, `redisUrl`, `url`, `dsn`, `credentials`, `auth`,
    `code`, `otp`, `pin`, `pass`, `pwd`, `hash`, `cookie`, `bearer`. `encryptionKey` и `redisUrl` — прямые
    названия секретов этого сервиса (`SESSION_ENCRYPTION_KEY`, `REDIS_URL`).
  - Значения, которые не редактируются: токен бота (`<digits>:<35 символов>`), ключ xAI (`xai-…`),
    `Bearer …`, URL с паролем (`redis://:pw@host`, `https://user:pw@host`), API hash (32 hex),
    base64-ключ шифрования.
  - `SESSION_STRING_PATTERN` (`:17`) не срабатывает, когда перед `1` стоит буквенно-цифровой символ
    (`\b`), когда строка URL-кодирована (`%2B`, `%2F`, `%3D` рвут последовательность) и для префикса короче
    200 символов. По правилам префикс сессии — тоже утечка.
  - `PHONE_NUMBER_PATTERN` (`:19`) требует `+`, а DTO принимает номер без него (`auth.dto.ts:13`,
    `^\+?\d{7,15}$`).
  - Не-plain объекты обходятся через `Object.entries`: `Buffer` под нейтральным ключом уходит как
    `{"0":70,"1":65,…}` — то есть байты ключа целиком; у `Error` уходят перечислимые поля (например
    `command` у ошибок ioredis).
- Атака: сейчас ни один вызов эти дыры не использует. Но `risks.md` называет санитайзер защитой от худшего
  сценария, а `.claude/rules/telegram.md` — второй линией. Первая же правка, которая положит в `details`
  ошибку целиком, конфиг или URL, отправит секрет наружу без единой красной лампы в тестах.
- Расхождение с дизайном: `design.md` («Санитизация») разрешает только плоские примитивы и массивы строк,
  код пропускает вложенные объекты до глубины ALERT_DETAILS_MAX_DEPTH.
- Исправление: перейти к белому списку формы — примитивы и массивы примитивов, вложенные объекты только
  plain (`Object.getPrototypeOf(v) === Object.prototype`), всё остальное (`Buffer`, `Error`, `Map`,
  экземпляры классов) заменять маркером. Добавить фрагменты ключей `key` в составе (`encryptionkey`,
  `privatekey`), `url`, `dsn`, `credential`, `auth`, `cookie`, `bearer`, `pass`, `pwd`, `otp`, `pin`,
  `code`, `hash`. Добавить шаблоны значений: URL с userinfo (заменять только userinfo), токен бота,
  `xai-`, `Bearer`, 32 hex, base64 длиной от 40; телефон без `+` из 10–15 цифр в тексте ошибки. В шаблоне
  сессии убрать `\b` и понизить порог длины. Тест на каждый шаблон с поддельным значением.

## LOW

### L1. Сырой текст сторонних ошибок уходит в алерт

- Файлы: `src/shared/utils/process-handlers.ts:22-30`, `:61-64` и собственный `describeError` (`:80-86`);
  `src/main.ts:37-39`; `src/digest/digest.service.ts:157-162` (`cause` включает `error.message` любой
  не-HTTP ошибки), `:169`; `src/digest/digest.scheduler.ts:46-48`; `src/telegram/utils/telegram-errors.ts:64-66`
  (локальные ошибки GramJS эхом повторяют ввод вызывающего).
- Сейчас проверенные источники безопасны, но `unhandledRejection` и сбой старта пересылают текст любой
  библиотеки, включая будущие. Пример класса риска: undici на неразбираемом URL бросает
  `Failed to parse URL from <url>`; если такой вызов когда-нибудь окажется вне обёрток `BotNotifier`, в алерт
  уйдёт URL с токеном бота. Защиту даёт только M2.
- Исправление: для `unhandledRejection`, `uncaughtException`, ошибки остановки и сбоя старта отправлять в
  алерт `name` и `code`, а `message` — только в лог; в `reportFailure` не добавлять `error.message` в
  `details.cause`. Объединить два `describeError` (в `process-handlers.ts` и `telegram-errors.ts`).

### L2. Подавление дублей обходится через имя канала; info-алерты не подавляются

- Файлы: `src/telegram/channel.service.ts:60` (операция `Posts: @${channelUsername}` входит в `message`),
  `src/alerts/alert.service.ts:87-97`, `src/redis/redis.module.ts:21`.
- Ключ дедупликации — `level:message`, поэтому 5xx или 429 по каждому новому имени канала — отдельный
  алерт. Владелец API-ключа (до RATE_LIMIT_DEFAULT запросов в минуту) или общий сбой Telegram во время
  дайджеста на 50 каналов дают поток алертов до ALERT_QUEUE_MAX_SIZE. `Redis connection restored` не
  подавляется: при мигающем Redis — один алерт на каждое восстановление.
- Исправление: в `message` писать постоянную операцию (`Posts failed: 502`), имя канала — в `details`;
  ограничить частоту info-алертов о Redis тем же окном.

### L3. Кривой `REDIS_URL` валит запуск

- Файл: `src/redis/redis-client.ts:86` — конструктор ioredis бросает `Invalid URL` синхронно, фабрика
  провайдера в `redis.module.ts:34-40` это не ловит, приложение не стартует. Секрета в причине нет
  (проверено), но это противоречит правилу «boot never fails on configuration» и превращает опечатку в
  переменной в цикл падений. Исправление: проверить URL в `getSessionPersistenceConfig` через `new URL` и при
  ошибке уходить в режим памяти с одним предупреждением без значения.

### L4. Повторяющиеся риски прошлых аудитов (контекст, не новое)

- `rtk npm audit --omit=dev`: 16 runtime-уязвимостей (1 critical `proxy-addr`, 6 high: `express`,
  `@nestjs/platform-express`, `path-to-regexp`, `multer`, `lodash`, `ip-address`); было 15 на 2026-09-26.
  Блок 11 новых зависимостей не добавляет (используется встроенный `fetch`).
- Открытые находки блока 10 (M1–M5) этим изменением не затронуты.

## Что проверено и в порядке

- `AlertService` не бросает вызывающему, очередь, параллелизм и карта дублей ограничены, таймер ожидания при
  остановке очищается; `sendAlert` очищает таймер и слушатель отмены на каждом пути.
- Сбой отправки логируется одной строкой за окно, без URL, ключа и тела.
- Алерты о сбоях по вине вызывающего (400, 401, 404) не отправляются, так что нет оракула существования
  сессии или номера через алерт-канал.
- Предикаты `hasTelegramCredentials`, `hasApiKeys`, `isSessionPersistenceConfigured` ничего не логируют и не
  возвращают значений; `missingDigestVariables` возвращает только имена.
- Переменные `ALERTS_*` описаны в `CLAUDE.md`, `docs/deployment/railway-alerts.md` указывает `https:`-адрес.

## Вердикт

CRITICAL и HIGH нет; секреты Telegram, токен бота, ключ Grok, `ALERTS_API_KEY` и URL Redis на сегодня до
алертов не доходят. Модуль можно выпускать за доверенными API-ключами при условии, что `ALERTS_URL` задан как
`https:`. До следующего изменения, которое добавит новые поля в `details`, нужно закрыть M1 (`redirect:
'error'` и только `https:`) и M2 (белый список формы и расширенные шаблоны): сейчас защиту обеспечивает
дисциплина вызывающих, а не санитайзер. Общий вердикт по сервису не меняется: безопасен за доверенными
ключами, не для открытого публичного доступа (переносимые находки прошлых блоков).
