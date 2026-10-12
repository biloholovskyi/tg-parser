# Блок 11 — Дизайн: алерты

## Модуль `src/alerts/`

| Файл | Назначение |
|------|-----------|
| `alerts.module.ts` | `@Global()` модуль, экспортирует `AlertService` |
| `alert.service.ts` | `info`, `warning`, `error`; не бросает исключений и не задерживает вызывающего |
| `alert-sender.ts` | чистая функция одного `POST /alerts` с таймаутом; используется сервисом и `main.ts` до появления приложения |
| `alert-sanitizer.ts` | обрезка `message` и `details`, удаление запрещённых ключей и значений, похожих на секреты |
| `constants.ts` | потолки, таймауты, окно подавления дублей |
| `interfaces/alert.interface.ts` | `AlertLevel`, `AlertPayload`, `AlertDetails` |
| `src/config/alerts.config.ts` | загрузчик `ALERTS_URL`, `ALERTS_API_KEY`, `ALERTS_SERVICE_NAME` |

## Поведение `AlertService`

- Вызов ставит алерт в очередь и сразу возвращается; отправка идёт в фоне.
- Очередь ограничена ALERT_QUEUE_MAX_SIZE; при переполнении новый алерт отбрасывается, счётчик отброшенных уходит в `details` следующего.
- Одновременно не более ALERT_MAX_CONCURRENT запросов.
- Таймаут запроса ALERT_CALL_TIMEOUT_MS, таймер очищается всегда; один повтор только на сетевую ошибку, таймаут или 5xx; 4xx не повторяется.
- Подавление дублей: алерт warning/error с тем же ключом (`level` + `message`) в течение ALERT_DEDUP_WINDOW_MS не отправляется; число подавленных добавляется в `details` следующего алерта с этим ключом. Карта ключей ограничена ALERT_DEDUP_MAX_KEYS. Info-алерты о логине не подавляются.
- Неудачная отправка пишет в лог одну строку (статус или причина, без ключа и тела); алерт о неудачном алерте не отправляется.
- Без `ALERTS_URL` или `ALERTS_API_KEY` сервис выключен: одно предупреждение при старте, вызовы — no-op.
- `onApplicationShutdown` ждёт очередь не дольше ALERT_DRAIN_TIMEOUT_MS, затем отбрасывает остаток.
- `serviceName` — из `ALERTS_SERVICE_NAME`, по умолчанию `tg-parser`.

## Карта алертов

| Событие | Уровень | Место вызова |
|---------|---------|-------------|
| Успешный логин | info | `AuthService.completeLogin`: id, username, 2FA да/нет, сессия сохранена да/нет |
| Сбой старта | error | `main.ts` через `alert-sender` напрямую, до `process.exit` |
| Uncaught exception | error | `registerProcessHandlers`, до закрытия приложения |
| Unhandled rejection | error | `registerProcessHandlers` |
| Ошибка при остановке | warning | `closeApplication` |
| Связь с Redis потеряна | error | колбэк состояния из `createRedisClient`, подписка в `RedisModule` |
| Связь с Redis восстановлена | info | там же |
| Сессия не сохранена | warning | `SessionStore.adopt` |
| Telegram 5xx (недоступен, 502, нет конфигурации) | error | `failWith` через приёмник алертов |
| Flood wait 429 | warning | `failWith` через приёмник алертов |
| Дайджест упал | error | `DigestService.reportFailure`: триггер, статус, причина |
| Уведомление о сбое не доставлено | error | `DigestService.reportFailure` |
| Саммари в запасном режиме, недоступные каналы, непереведённые посты | warning | `DigestService.execute`, один алерт на запуск со всеми счётчиками |
| Плановый запуск пропущен | warning | `DigestService.runScheduled` |
| Расписание не зарегистрировано | error | `DigestScheduler.onApplicationBootstrap` |
| Неполная конфигурация | warning | `BootConfigReporter.onApplicationBootstrap`, один алерт со списком имён переменных |

Ошибки 400/401/404 по вине вызывающего (неверный код, неизвестная сессия, нет канала) — не алерт.

## Связи без нарушения границ

- `failWith(logger, operation, error, alerts?)` получает необязательный приёмник `AlertSink` (интерфейс из `src/alerts/interfaces/`); сервисы `src/telegram/` передают свой `AlertService`.
- `createRedisClient(url, onConnectionChange?)` вызывает колбэк при переходе «потеряна» и «восстановлена»; `RedisModule` вешает на него `AlertService`.
- `registerProcessHandlers(app, alerts)` получает `AlertService` из `app.get` в `main.ts`.
- Конфиг-загрузчики экспортируют чистые функции проверки, которые читает `BootConfigReporter` (`src/alerts/boot-config-reporter.ts`); предупреждения в логе остаются как есть.

## Последовательность: успешный логин

1. `AuthService.continueLogin` получает `auth.Authorization` из `SignIn` или `CheckPassword`.
2. `completeLogin` вызывает `SessionStore.adopt`, получает `sessionString` и признак сохранения.
3. `AlertService.info('New Telegram login', { userId, username, has2fa, isPersisted })` — в очередь, без ожидания.
4. Ответ клиенту уходит сразу; отправка алерта на время ответа не влияет.

## Санитизация

- Разрешённые поля `details` — плоские примитивы и массивы строк, не глубже ALERT_DETAILS_MAX_DEPTH, сериализация не длиннее ALERT_DETAILS_MAX_CHARS.
- Ключи из запрещённого списка (`sessionString`, `phone`, `phoneNumber`, `phoneCode`, `password`, `apiHash`, `token`, `apiKey`, `authorization`) удаляются.
- Строки, похожие на `StringSession` (тот же признак, что в `.claude/hooks/guard-secrets.js`), и номера телефонов заменяются на `[redacted]`.
- Ошибки передаются только через `describeError`.

## ADR

Отдельный ADR не нужен: новый внешний вызов не меняет то, что сервис хранит, и модель сессий. Решение «fire-and-forget с очередью в памяти» зафиксировано здесь и в [risks.md](risks.md).
