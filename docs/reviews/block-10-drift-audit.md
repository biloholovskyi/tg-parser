# Аудит расхождений документации и кода — блок 10

Дата: 26.09.2026. Процесс: `.claude/rules/drift-audit.md`. Ветка `1.5.0`, план `docs/plans/block-10-daily-digest/`.

Проверено против кода: `CLAUDE.md`, `.claude/rules/*.md`, `.claude/agents/*.md` (описания проекта), `README.md`, `DEPLOYMENT.md`, `docs/deployment/railway-redis.md`, `docs/testing/digest-manual-testing.md`; источники истины — `src/`, `package.json`, `railway.toml`, `test/`.

Итог: утверждений «сессии живут только в памяти / ничего не сохраняется» как описания основного режима не осталось. Найдено 12 расхождений класса «документ неверен», 1 нарушение правила версий и 3 открытых решения.

## Класс 1 — документ неверен, код прав (правка документа)

1. Перезапуск заставляет всех авторизоваться заново.
   - Утверждение: `.claude/rules/runtime-resources.md:66` и `.claude/agents/resource-leak-auditor.md:20` — каждый перезапуск опустошает кэш и «forces every caller to re-authenticate».
   - Код: `src/telegram/session-store.ts:75-125` — промах кэша поднимает клиента из записи Redis (`restore`), повторная авторизация не нужна.
   - Правка: «every restart empties the client cache and reconnects every active session from its stored record; without Redis it forces re-authentication».

2. Каждый внешний вызов несёт EXTERNAL_CALL_TIMEOUT_MS.
   - Утверждение: `.claude/rules/runtime-resources.md:41`.
   - Код: `src/digest/grok/grok.client.ts:59` (GROK_CALL_TIMEOUT_MS), `src/digest/bot-notifier.ts:64` (BOT_CALL_TIMEOUT_MS), `src/redis/redis-client.ts:28-29` (REDIS_CONNECT_TIMEOUT_MS, REDIS_COMMAND_TIMEOUT_MS). Эти константы решены в `docs/plans/block-10-daily-digest/design.md:112` и уже перечислены в блоке Constants того же файла (строки 29, 31), то есть файл противоречит сам себе.
   - Правка: «Every Telegram call carries EXTERNAL_CALL_TIMEOUT_MS; every other external call carries its own named timeout from the Constants above, and every timer is cleared once the call settles».

3. Строка сессии никогда не пишется на диск.
   - Утверждение: `.claude/rules/api-security.md:44`.
   - Код: `src/telegram/session-repository.ts:28-35` сохраняет сессию (зашифрованную AES-256-GCM) в Redis; `docs/deployment/railway-redis.md:39-49` требует тома и AOF, то есть шифротекст лежит на диске Redis. Решение зафиксировано в `docs/plans/block-10-daily-digest/adr-session-redis.md`.
   - Правка: «never written to disk in plaintext; it is persisted only by `SessionRepository`, encrypted, under a SHA-256 key (ADR `docs/plans/block-10-daily-digest/adr-session-redis.md`)».

4. Аудитор безопасности проверяет, что учётные данные не сохраняются.
   - Утверждение: `.claude/agents/security-auditor.md:21` — «Confirm no credential ... is persisted».
   - Код: см. п. 3.
   - Правка: «Confirm that the only persisted credential is the session record written by `SessionRepository` (encrypted, SHA-256 key), and that no personal data is persisted».

5. `main.ts` регистрирует shutdown hooks.
   - Утверждение: `.claude/rules/architecture.md:39` — «registers process handlers and shutdown hooks».
   - Код: `src/main.ts:23-26` — `enableShutdownHooks` намеренно не вызывается, единственный путь остановки — `registerProcessHandlers`.
   - Правка: «registers the process handlers (the single shutdown path; Nest `enableShutdownHooks` is deliberately not used)».

6. Каталог `src/shared/types/`.
   - Утверждение: `.claude/rules/architecture.md:41` перечисляет `types/`.
   - Код: каталога `src/shared/types/` нет.
   - Правка: убрать `types/` из списка.

7. Чтение `process.env.TELEGRAM_*` вне загрузчика.
   - Утверждение: `.claude/rules/telegram.md:89` — анти-паттерн «Reading `process.env.TELEGRAM_*` outside the config loader» (подразумевается `telegram.config.ts`, строка 26).
   - Код: `src/config/digest.config.ts:9-10,50-51` читает `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_CHAT_ID` — это законный загрузчик в `src/config/`, но под буквой правила он нарушение.
   - Правка: «Reading `process.env.TELEGRAM_API_*` outside `src/config/telegram.config.ts`, or any env var outside a loader in `src/config/`».

8. «В Redis лежат только строки сессий».
   - Утверждение: `docs/deployment/railway-redis.md:7`.
   - Код: `src/telegram/constants.ts:104`, `src/telegram/session-repository.ts:83` — ещё ключ `tg:digest-session` с SHA-256 отмеченной сессии.
   - Правка: добавить пункт «и ключ `tg:digest-session` — хеш сессии дайджеста, не сама сессия».

9. 503 означает только недоступность Telegram.
   - Утверждение: `README.md:204` («`503` — Telegram недоступен»); `README.md:151` для `/telegram/me`.
   - Код: `src/telegram/utils/telegram-errors.ts:31,160-162` — 503 `Session storage is unreachable, retry later` при недоступном Redis.
   - Правка: «`503` — Telegram или хранилище сессий (Redis) недоступны».

10. Строка 400 в таблице ошибок только для маршрута постов.
    - Утверждение: `.claude/rules/telegram.md:52` — «Missing `sessionString` header on the posts route».
    - Код: `src/digest/digest.controller.ts:34-36` отвечает тем же 400 для `PUT /digest/session`.
    - Правка: «on the posts route or `PUT /digest/session`».

11. Перезапуск = пустой кэш, без пути восстановления.
    - Утверждение: `.claude/rules/plan-audit.md:48` («in-memory session cache»), `.claude/agents/test-writer.md:40`, `.claude/agents/test-coverage-auditor.md:18` («empty cache after restart»), `.claude/agents/debugger.md:27` («entries lost on restart» как симптом).
    - Код: `src/telegram/session-store.ts:101-125`, `src/telegram/session-repository.ts:41-48` — после перезапуска сессия восстанавливается; новые ветки — восстановление, 401 без записи, 503 при недоступном Redis.
    - Правка: добавить в чек-листы «restore from `SessionRepository` after restart, 401 without a record, 503 when Redis is down»; в `plan-audit.md:48` — «the session cache or the persisted session store».

12. Относительные ссылки в новых документах.
    - Утверждение: `.claude/rules/commit-message-and-crosslinks.md` (CROSSLINK_INTERNAL_STYLE = путь от корня, без `../`).
    - Документы: `docs/testing/digest-manual-testing.md:11` (`../deployment/railway-redis.md`), `docs/deployment/railway-redis.md:127` (`../../DEPLOYMENT.md`).
    - Правка: пути от корня репозитория.

Мелочь без обязательной правки: `.claude/rules/architecture.md:34` перечисляет `src/digest/utils/` как «formatter, splitter, coverage», в коде ещё `html.ts`, `post-selection.ts`, `text.ts`.

## Класс 2 — правило право, нарушение на стороне репозитория

- Имя ветки. `.claude/rules/versioning-changelog.md:14,35` требует ветку `r-{version}`; текущая ветка `1.5.0`. `package.json` — `1.5.0`, верхняя запись `CHANGELOG.md` — `[1.5.0] 26.09.2026` (сегодня), обе совпадают. Правило стоит; действие — с согласия пользователя переименовать ветку в `r-1.5.0` (`rtk git branch -m 1.5.0 r-1.5.0`) до коммита.

## Класс 3 — открытые решения (к пользователю, ничего не правлено)

1. Режим «только память» и дайджест.
   - Документы: `CLAUDE.md:5`, `.claude/rules/architecture.md:60` («every session is lost on restart»), комментарий `src/telegram/session-repository.ts:11-12` (отметка дайджеста «held in memory for the life of the process»).
   - Код: без Redis `SessionRepository.isKnown` всегда `false` (`session-repository.ts:96-100`), поэтому клиент, вытесненный по простою (SESSION_CACHE_IDLE_TTL_MS, `src/telegram/constants.ts:5`) или по LRU, больше не поднимается — 401 (`session-store.ts:112-115`). Сессия теряется не только при перезапуске, а через 30 минут без использования; отметка дайджеста остаётся, но запуск в 23:00 почти всегда кончится сообщением «Сессия дайджеста не задана или отозвана».
   - Развилка: (а) задокументировать, что без Redis сессия живёт, пока используется чаще SESSION_CACHE_IDLE_TTL_MS, а дайджест требует Redis; (б) изменить код: в режиме памяти держать клиента сессии дайджеста вне простоя или хранить отмеченную строку в памяти для восстановления.

2. CORS и `PUT /digest/session`.
   - Код: `src/config/cors.config.ts:8` — разрешены только `GET`, `POST`, `OPTIONS`; браузер с разрешённого источника не сможет вызвать `PUT /digest/session`.
   - Ни один документ не говорит ни «да», ни «нет».
   - Развилка: добавить `PUT` в CORS_ALLOWED_METHODS или записать в `.claude/rules/api-security.md`, что маршруты дайджеста — только для серверных вызовов.

3. Новые секреты вне жёсткого правила.
   - `CLAUDE.md:27`, `.claude/rules/telegram.md:25-27` и `.claude/hooks/guard-secrets.js` перечисляют только секреты Telegram-аккаунта. `GROK_API_KEY`, `TELEGRAM_BOT_TOKEN`, `SESSION_ENCRYPTION_KEY` и пароль внутри `REDIS_URL` в правило не входят, хотя код обращается с ними как с секретами (`src/digest/bot-notifier.ts:34-36`, `src/redis/redis-client.ts:22-23`, `src/config/redis.config.ts:20`).
   - Развилка: расширить жёсткое правило и хук на эти значения или оставить правило только для учётных данных Telegram. Расширение жёсткого правила — решение пользователя.

## Проверено, расхождений нет

- Модель сессий: `CLAUDE.md:5,52`, `.claude/rules/architecture.md:58-59,61-66`, `.claude/rules/telegram.md:15-16,28-29,35,43-44`, `.claude/rules/core-rules.md:10` — Redis, AES-256-GCM, ключ SHA-256, SESSION_STORE_TTL_S с продлением (`session-repository.ts:28-56`), удаление записи при отказе Telegram (`session-store.ts:89-94`), незавершённые входы только в памяти (`auth.service.ts`), процесс не пишет на диск (в `src/` нет `fs`).
- REST: `GET /telegram/health`, `POST /telegram/auth`, `GET /telegram/me`, `GET /telegram/channel/:channelUsername/posts` (`telegram.controller.ts`), `PUT /digest/session` 204/400/401, `POST /digest/run` 202/409/503 (`digest.controller.ts`, `digest.service.ts:59-68`); `@PublicRoute()` только на health; глобальные `APP_GUARD` (`telegram.module.ts:26-28`) закрывают и маршруты дайджеста.
- Переменные окружения: все чтения `process.env` в `src/config/*` и `PORT` в `main.ts:28` совпадают с таблицей `CLAUDE.md:176-189`; значения по умолчанию `0 23 * * *`, `Europe/Kyiv`, `grok-4.6` (`digest.config.ts:13-16`); поведение при отсутствии — одно предупреждение, загрузка не падает.
- Константы `.claude/rules/runtime-resources.md:14-31` совпадают с `src/telegram/constants.ts`, `src/redis/redis.constants.ts`, `src/config/digest.config.ts:19`, `src/digest/constants.ts`; `.claude/rules/api-security.md:22-27` — с `http.constants.ts`, `rate-limit.constants.ts`.
- Строки логов в `railway-redis.md:123-126,172-176` и `digest-manual-testing.md` (L1–L5, D2–D4, R2, R4, R5) совпадают с `redis.module.ts:25`, `redis-client.ts:43,47`, `redis.config.ts:27,33-34`, `digest.config.ts:55`, `digest.scheduler.ts:40`, `telegram.service.ts:90`, `telegram-errors.ts:26,31`, `session-header.ts:5`, `digest.service.ts:24-25,31`. Случаи S4–S6, R6, C1, C2, C7 подтверждены кодом.
- GramJS только в `src/telegram/`; `TelegramClient` создаётся только в `telegram-client.factory.ts:38`; `ioredis` только в `src/redis/` и `session-repository.ts` (тип).
- Развёртывание: `railway.toml` (RAILPACK, `npm run start:prod`, порт 8080, `/telegram/health`) совпадает с `main.ts` и `http.constants.ts:29`.
- Скрипты из `CLAUDE.md` и `.claude/rules/tooling.md` есть в `package.json`.
- Инвентарь: 15 агентов и 15 навыков в `.claude/agents/`, `.claude/skills/` совпадают со списками `CLAUDE.md` и `.claude/rules/index.md`.
- E2E: `test/setup-env.ts` отключает Redis, `test/digest.e2e-spec.ts` подменяет `TelegramService` — утверждение `railway-redis.md:158` верно.
