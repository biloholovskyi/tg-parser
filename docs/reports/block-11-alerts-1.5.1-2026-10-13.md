# Отчёт о завершении плана — block-11-alerts 1.5.1

- Компонент: `block-11-alerts`
- Версия: `1.5.1`
- Дата: 2026-10-13
- Ветка: `r-1.5.1`
- Тир сложности: `standard`
- План: [block-11-alerts-implementation-plan.md](../plans/block-11-alerts/block-11-alerts-implementation-plan.md)
- Замысел и карта алертов: [design.md](../plans/block-11-alerts/design.md) · Риски и откат: [risks.md](../plans/block-11-alerts/risks.md) · Research: [research.md](../plans/block-11-alerts/research.md)
- Ход работ: [history.md](../plans/block-11-alerts/history.md) · Итоги: [reflect.md](../plans/block-11-alerts/reflect.md)
- Аудит безопасности: [security-audit-2026-10-13.md](../reviews/security-audit-2026-10-13.md)
- Аудит ресурсов: [block-11-resource-audit.md](../reviews/block-11-resource-audit.md)
- Инструкция по переменным алертов на Railway: [railway-alerts.md](../deployment/railway-alerts.md)

## Summary

Сервис сообщает во внешний алерт-сервис TechAdminServer (`POST /alerts`, ключ только в заголовке `X-API-Key`) о каждом критическом сбое (warning, error) и о каждом успешном логине (info, только Telegram id и username). Новый глобальный модуль `src/alerts/` отправляет алерты в фоне: ограниченная очередь, подавление повторов, один повтор, таймаут и санитайзер деталей, поэтому алерты не замедляют и не ломают основной сервис и не несут секретов. Без `ALERTS_URL` или `ALERTS_API_KEY` алерты выключены, остальное поведение не меняется.

## Phases

| Фаза | Статус | Доказательство |
|------|--------|----------------|
| [Phase 01 — модуль алертов](../plans/block-11-alerts/phase-01-alerts-module.md) | done | `rtk npm.cmd test -- src/alerts src/config/alerts.config` — 6 наборов, 103 теста; `fetch(` в `src/alerts` только в `alert-sender.ts`, импорта `telegram` нет |
| [Phase 02 — логин, Telegram и Redis](../plans/block-11-alerts/phase-02-auth-telegram-redis.md) | done | `rtk npm.cmd test -- src/telegram src/redis` — 14 наборов, 518 тестов (весь unit-набор — 1155); E2E — 5 наборов, 68 тестов, `fetch` за прогон не вызывается; ключи логин-алерта ровно `userId`, `username`, `has2fa`, `isPersisted` |
| [Phase 03 — дайджест, процесс и конфигурация](../plans/block-11-alerts/phase-03-digest-process-boot.md) | done | `rtk npm.cmd test` — 60 наборов, 1231 тест; E2E — 5 наборов, 68 тестов; каждая строка карты алертов покрыта тестом, соответствие в `history.md` |
| [Phase 04 — Finalize](../plans/block-11-alerts/phase-04-finalize.md) | done, кроме smoke на настоящем TechAdminServer и решения по hook — за пользователем | Аудиты выполнены, находки исправлены; итоговые проверки зелёные — см. Test evidence; версия `1.5.1` в `package.json`, `package-lock.json` и `CHANGELOG.md` |

## Affected files

База измерения — коммит `13e2825`. Окно включает коммиты пользователя `66346ac` и `d19b006` («Alert TG parser») и незакоммиченные изменения. Размеры взяты из `rtk git diff --stat 13e2825`, выполненного при написании отчёта: 73 файла, 6000 добавленных и 105 удалённых строк. Вызывающая сторона передала замер 5983 добавленных строк; разница в 17 строк — правки документов плана после её замера. Этот отчёт, правка `docs/reports/README.md` и строка «Отчёт:» в индексе плана в замер не входят.

`git diff --stat` не видит неотслеживаемые файлы. Они перечислены отдельно с числом строк по `wc -l`.

Продуктовый код:

| Файл | Изменение, строк |
|------|------------------|
| `src/alerts/alert-sanitizer.ts` | 184 |
| `src/alerts/alert.service.ts` | 158 |
| `src/alerts/alert-sender.ts` | 118 |
| `src/config/alerts.config.ts` | 80 |
| `src/telegram/auth.service.ts` | 57 |
| `src/alerts/utils/alert-deduplicator.ts` | 49 |
| `src/alerts/constants.ts` | 47 |
| `src/digest/digest.service.ts` | 47 |
| `src/telegram/utils/telegram-errors.ts` | 43 |
| `src/alerts/boot-config-reporter.ts` | 39 |
| `src/alerts/interfaces/alert.interface.ts` | 38 |
| `src/alerts/boot-failure-alert.ts` | 28 |
| `src/shared/utils/process-handlers.ts` | 26 |
| `src/alerts/utils/failure-log-throttle.ts` | 26 (не отслеживается) |
| `src/alerts/utils/idle-signal.ts` | 24 (не отслеживается) |
| `src/telegram/utils/login-identity.ts` | 22 |
| `src/redis/redis-client.ts` | 20 |
| `src/redis/redis.module.ts` | 19 |
| `src/telegram/session-store.ts` | 18 |
| `src/alerts/alerts.module.ts` | 17 |
| `src/config/redis.config.ts` | 16 |
| `src/config/telegram.config.ts` | 16 |
| `src/digest/digest.scheduler.ts` | 14 |
| `src/main.ts` | 14 |
| `src/telegram/channel.service.ts` | 11 |
| `src/digest/grok/grok.client.ts` | 7 |
| `src/config/api-keys.config.ts` | 5 |
| `src/config/digest.config.ts` | 5 |
| `src/telegram/telegram.service.ts` | 4 |
| `src/app.module.ts` | 2 |

Тесты:

| Файл | Изменение, строк |
|------|------------------|
| `src/alerts/alert.service.spec.ts` | 585 |
| `src/alerts/alert-sanitizer.spec.ts` | 552 |
| `src/telegram/telegram.service.spec.ts` | 441 |
| `src/alerts/alert-sender.spec.ts` | 360 |
| `src/digest/digest.service.spec.ts` | 303 |
| `src/shared/utils/process-handlers.spec.ts` | 229 |
| `src/config/alerts.config.spec.ts` | 219 |
| `src/alerts/boot-config-reporter.spec.ts` | 203 |
| `src/telegram/utils/telegram-errors.spec.ts` | 203 |
| `src/main.spec.ts` | 177 |
| `src/alerts/boot-failure-alert.spec.ts` | 165 |
| `src/redis/redis-client.spec.ts` | 122 |
| `src/digest/digest.scheduler.spec.ts` | 106 |
| `src/alerts/utils/alert-deduplicator.spec.ts` | 103 |
| `src/redis/redis.module.spec.ts` | 103 |
| `src/alerts/utils/idle-signal.spec.ts` | 94 (не отслеживается) |
| `src/telegram/utils/login-identity.spec.ts` | 87 |
| `src/alerts/utils/failure-log-throttle.spec.ts` | 84 (не отслеживается) |
| `src/config/digest.config.spec.ts` | 80 |
| `src/telegram/session-store.spec.ts` | 72 |
| `src/alerts/alerts.module.spec.ts` | 67 |
| `src/config/redis.config.spec.ts` | 65 |
| `src/config/telegram.config.spec.ts` | 59 |
| `src/config/api-keys.config.spec.ts` | 55 |
| `test/no-network.e2e-spec.ts` | 31 |
| `src/digest/grok/grok.client.spec.ts` | 13 |
| `test/setup-env.ts` | 3 |

Документация, правила и версия:

| Файл | Изменение, строк |
|------|------------------|
| `docs/deployment/railway-alerts.md` | 50 (не отслеживается) |
| `CLAUDE.md` | 16 |
| `.claude/rules/architecture.md` | 5 |
| `.claude/rules/runtime-resources.md` | 4 |
| `CHANGELOG.md` | 4 |
| `package-lock.json` | 4 |
| `package.json` | 2 |
| `.claude/rules/telegram.md` | 1 |

Новых зависимостей нет.

Также в окне: артефакты плана `docs/plans/block-11-alerts/*` (9 отслеживаемых файлов, 518 строк по `diff --stat`, и неотслеживаемый `reflect.md`, 31 строка), отчёты аудитов `docs/reviews/security-audit-2026-10-13.md` (155 строк) и `docs/reviews/block-11-resource-audit.md` (146 строк) — оба не отслеживаются, память агентов `.claude/agent-memory/*` (4 отслеживаемых файла, 44 строки, и неотслеживаемый `resource-leak-auditor/reference_nest_shutdown_order.md`, 15 строк).

## Test evidence

Итоговый прогон после всех исправлений по аудитам, по данным вызывающей стороны:

- `rtk npm.cmd run lint` — без ошибок
- `rtk npm.cmd run build` (`nest build`) — без ошибок
- `rtk npm.cmd test` — 62 набора из 62, 1321 тест из 1321, все прошли
- `rtk npm.cmd run test:e2e` — 5 наборов из 5, 68 тестов из 68, все прошли

При написании отчёта тесты повторно не запускались.

Не запускалось: `rtk npm run test:cov`, поэтому числа покрытия в отчёте не приводятся.

Локальный smoke по данным вызывающей стороны:

- собранный сервис без переменных алертов: одно предупреждение `Alerts disabled`, `GET /telegram/health` — 200;
- собранный сервис с локальным поддельным алерт-сервером: сервер получил два `POST /alerts` с заголовком `X-API-Key` — «Incomplete configuration at boot» и «Digest disabled»; ключа в логах нет;
- неверный ключ проверен только юнит-тестом (одна строка `Alert not delivered: HTTP 401` за окно), на живом сервисе не проверялся.

Не выполнено — за пользователем:

- smoke с настоящим TechAdminServer: алерт доходит со статусом доставки `sent` и появляется в Telegram-чате алертов (критерий приёмки Phase 04 не подтверждён);
- smoke настоящего логина на Railway: info-алерт с id и username, без телефона.

## API artifacts

REST-контракт сервиса не менялся: маршрутов, DTO и форм ответа не добавлено и не изменено. Артефакты в `docs/testing/` не нужны и не создавались. Внешний контракт TechAdminServer описан в разделе «Внешний сервис» в [research.md](../plans/block-11-alerts/research.md); сам `swagger.json` в репозиторий не входит.

Новые необязательные переменные окружения: `ALERTS_URL`, `ALERTS_API_KEY`, `ALERTS_SERVICE_NAME` — см. [railway-alerts.md](../deployment/railway-alerts.md).

## Findings fixed during Finalize

- Безопасность M1: `sendAlert` шёл за редиректом и пересылал `X-API-Key` и тело на чужой адрес — исправлено, есть регрессионный тест.
- Безопасность M2: санитайзер пропускал `X-API-Key`, `accessToken`, `Buffer` и `Error` — исправлено, есть регрессионный тест.
- Ресурсы MEDIUM-1: подавление повторов срабатывало до проверки места в очереди — порядок исправлен.
- Ресурсы MEDIUM-3: ложные error-алерты при каждом деплое — приём алертов закрывается через `beginShutdown` в начале пути остановки.
- Ресурсы MEDIUM-4: остановка ждала запрос Grok в полёте — `GrokClient` закрывает агент через `destroy()`.
- Ресурсы MEDIUM-5: имя канала в тексте алерта давало столько алертов, сколько каналов — имя перенесено в `details`.
- Ресурсы LOW-1: алерт «Error during shutdown» не мог дойти — удалён, строка лога осталась.

Итог аудитов: в безопасности 0 CRITICAL и 0 HIGH; в ресурсах утечек нет, CRITICAL и HIGH нет.

## Problems and tech debt

Источники: [reflect.md](../plans/block-11-alerts/reflect.md), доказательства Phase 04, отчёты аудитов и факты вызывающей стороны.

Решения за пользователем:

- Нужен ли в `.claude/hooks/guard-secrets.js` шаблон, блокирующий запись литерала `ALERTS_API_KEY` в файлы репозитория. Правка только с согласия пользователя.
- Smoke с настоящим TechAdminServer и настоящим логином — см. Test evidence.
- Ключ TechAdminServer задаётся вручную в `.env` и на Railway.

Технический долг из `reflect.md`:

- Алерт о необработанном исключении идёт через общую очередь без приоритета: при полной очереди или медленном алерт-сервисе он может не успеть до выхода (ресурсы MEDIUM-2). Возможное решение — прямая отправка параллельно с `app.close()`.
- Info «Redis connection restored» не подавляется: при частых перезапусках Redis — до нескольких алертов в минуту (ресурсы LOW-2).
- Счётчики отброшенных и подавленных алертов теряются, если не доставлен алерт, который их нёс (ресурсы LOW-4).
- В логе `DigestScheduler` текст ошибки — `error.message`, а в алерте — `describeError(error)`; расхождение только в формате.

Найдено аудитами, к блоку не относится:

- Неверный `REDIS_URL` синхронно роняет старт (`src/redis/redis-client.ts`, безопасность L3).
- `src/main.ts` читает `PORT` мимо `src/config/`.
- `rtk npm audit --omit=dev` — 16 уязвимостей в зависимостях, одна critical (`proxy-addr`).

Отличия от плана (записаны в `reflect.md`):

- В E2E `AlertService` не подменяется: переменные алертов обнуляются в `test/setup-env.ts`, тест `no-network.e2e-spec.ts` проверяет, что `fetch` не вызывается.
- Алерт «дайджест выключен» шлёт `DigestScheduler`, а не `BootConfigReporter`.
- Добавлены `utils/alert-deduplicator.ts`, `utils/failure-log-throttle.ts`, `utils/idle-signal.ts` и `src/main.spec.ts`.

Остальные находки LOW — в [аудите безопасности](../reviews/security-audit-2026-10-13.md) и [аудите ресурсов](../reviews/block-11-resource-audit.md).
