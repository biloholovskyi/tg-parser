# Блок 11 — Алерты в TechAdminServer

## Миссия

- Сервис сообщает о каждом критическом сбое (warning, error) и о каждом успешном логине (info) во внешний алерт-сервис TechAdminServer, который доставляет их в Telegram.
- Алерты никогда не замедляют и не ломают основной сервис и никогда не содержат секретов.

## Профиль задачи

`feature` — 3 сигнала feature (новая возможность, несколько модулей, новая внешняя зависимость с архитектурным выбором), 0 сигналов bugfix.

## Тир сложности

`standard` — затронуты поток авторизации и работа с секретами, изменения в четырёх модулях (`telegram`, `redis`, `digest`, `shared`) и новый модуль `alerts`.

## Целевая версия

1.5.1 (указана пользователем).

## Высокорисковая поверхность

Да — поток авторизации и работа с секретами. Риски и откат: [risks.md](risks.md).

## Артефакты до кода

- Исследование: [research.md](research.md)
- Дизайн и карта алертов: [design.md](design.md)
- Риски и откат: [risks.md](risks.md)
- Контракт внешнего сервиса: раздел «Внешний сервис» в [research.md](research.md) (сам `swagger.json` в репозиторий не входит)

## Фазы

- Phase 01 (done, 103 юнит-теста зелёные) — модуль алертов: [phase-01-alerts-module.md](phase-01-alerts-module.md)
- Phase 02 (done, 518 unit + 68 E2E зелёные) — логин, Telegram и Redis: [phase-02-auth-telegram-redis.md](phase-02-auth-telegram-redis.md)
- Phase 03 (done, 1231 unit + 68 E2E зелёные) — дайджест, процесс и конфигурация: [phase-03-digest-process-boot.md](phase-03-digest-process-boot.md)
- Phase 04 (done; smoke на настоящем TechAdminServer и настоящий логин — за пользователем) — Finalize: [phase-04-finalize.md](phase-04-finalize.md)

Отчёт: [block-11-alerts-1.5.1-2026-10-13.md](../../reports/block-11-alerts-1.5.1-2026-10-13.md)

## Порядок и границы

- Фазы строго последовательны: Phase 02 и 03 внедряют `AlertService` из Phase 01.
- Phase 02 раньше Phase 03, потому что меняет поток авторизации.
- Контракт REST сервиса не меняется; новые переменные окружения необязательны; без них алерты выключены, остальное поведение сервиса от них не зависит.

## Покрытие правил

- `.claude/rules/telegram.md` — секреты не уходят в алерты, граница GramJS
- `.claude/rules/runtime-resources.md` — потолки очереди и карты дублей, таймауты, ожидание при остановке
- `.claude/rules/architecture.md` — новый модуль `src/alerts/`, без циклических импортов
- `.claude/rules/patterns.md` — пределы функций, константы
- `.claude/rules/testing.md` — тесты внутри каждой фазы, автор — `test-writer`
- `.claude/rules/refactor-security-audit.md`, `.claude/rules/drift-audit.md`, `.claude/rules/versioning-changelog.md`, `.claude/rules/report-generation.md` — Finalize

## Решённые вопросы

- Версия 1.5.1.
- Info-алерт на каждый успешный логин, только Telegram id и username.
- Отправка в фоне с ограниченной очередью, подавлением дублей и одним повтором; отключение — удалением переменной окружения.
- Сбои по вине вызывающего (400, 401, 404) — не алерт.

## Следующие действия

1. Задать `ALERTS_URL` и `ALERTS_API_KEY` в Railway по `docs/deployment/railway-alerts.md`.
2. Smoke на настоящем TechAdminServer: алерт неполной конфигурации и info при логине со статусом `sent`.
3. Решить, нужен ли в `.claude/hooks/guard-secrets.js` запрет на литерал `ALERTS_API_KEY`.
4. Коммит — по запросу пользователя.
