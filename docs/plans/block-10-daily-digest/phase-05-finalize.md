# Phase 05 — Finalize

Статус: done (реальный smoke-прогон за пользователем)

Требуемые правила: `.claude/rules/post-code-workflow.md`, `.claude/rules/refactor-security-audit.md`, `.claude/rules/drift-audit.md`, `.claude/rules/api-contracts.md`, `.claude/rules/versioning-changelog.md`, `.claude/rules/report-generation.md`, `.claude/rules/git-conventions.md`

## Цель

Блок закрыт одним гейтом: проверки зелёные, правила описывают новую модель, дайджест пришёл в реального бота.

## Чеклист

- [x] Post-code: `/post-code` — lint, build, unit, E2E зелёные
- [x] Аудит безопасности и ресурсов: `/audit-security` и `/audit-resources` по `src/redis/`, `src/digest/`, `src/telegram/session-*`; повтор post-code после правок
- [ ] (за пользователем) Smoke-прогон: Redis плагином Railway или локально; авторизация, перезапуск процесса, `/telegram/me` — `success`; `PUT /digest/session`; `POST /digest/run` — сообщение в боте с подвалом «Учтено N из N»; ручная сверка трёх тезисов с постами на отсутствие оценок
- [x] Drift: `/audit-drift`; переписать модель сессий в `CLAUDE.md`, `.claude/rules/telegram.md` (SESSION_PERSISTENCE, запрет на хранилище), `.claude/rules/architecture.md`, `.claude/rules/runtime-resources.md` (новые константы, Redis, задача по расписанию); у старого ADR пометка «заменено»
- [x] API-артефакты: `docs/testing/digest-manual-testing.md` и `docs/testing/digest-postman-collection.json` (JSON разбирается, без реальных секретов)
- [x] Документация: новые переменные окружения в таблице `CLAUDE.md`, маршруты в Architecture, `DEPLOYMENT.md` — переменные дайджеста; `docs/deployment/railway-redis.md` сверена с итоговым кодом (имена переменных, строки лога, коды ответов)
- [ ] (ветка за пользователем) Версия: ветка `r-1.5.0` (создание только по согласию пользователя), `package.json` — 1.5.0, `CHANGELOG.md` — `[1.5.0] DD.MM.YYYY` с пунктами блока
- [x] Reflect: `reflect.md` — уроки, расхождения с дизайном, техдолг
- [x] Отчёт: `/plan-report`, строка в `docs/reports/README.md`
- [x] Подготовка к коммиту по `.claude/rules/git-conventions.md`; коммит — только по запросу пользователя

## Команды проверки

- `rtk npm.cmd run lint`
- `rtk npm.cmd run build`
- `rtk npm.cmd test`
- `rtk npm.cmd run test:e2e`

## Критерии приёмки

- Все пункты чеклиста отмечены с доказательством в `history.md`.
- Сообщение дайджеста получено в реальном боте, число учтённых постов равно числу собранных.
- Аудит дрейфа не находит утверждения «только память» в правилах и `CLAUDE.md`.
- Отчёт существует и связан из индекса плана и из `docs/reports/README.md`.

## Доказательства

- `rtk npm.cmd run lint`, `rtk npm.cmd run build` — без ошибок; `rtk npm.cmd test` — 50 наборов, 949 тестов; `rtk npm.cmd run test:e2e -- --detectOpenHandles` — 5 наборов, 67 тестов, открытых ресурсов нет.
- Аудиты: [безопасность](../../reviews/block-10-security-audit.md), [ресурсы](../../reviews/block-10-resource-audit.md), [дрейф](../../reviews/block-10-drift-audit.md); находки high исправлены, остальное — в `reflect.md`.
- Локальный запуск собранного сервиса: 6 маршрутов, health 200, `POST /digest/run` без ключа 401.
- Артефакты: `docs/testing/digest-manual-testing.md`, `docs/testing/digest-postman-collection.json` (JSON разбирается).
- Отчёт: [block-10-daily-digest-1.5.0-2026-09-26.md](../../reports/block-10-daily-digest-1.5.0-2026-09-26.md), строка в `docs/reports/README.md`.
