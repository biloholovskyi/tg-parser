# Phase 04 — Finalize

Статус: todo

Правила: `.claude/rules/post-code-workflow.md`, `.claude/rules/refactor-security-audit.md`, `.claude/rules/drift-audit.md`, `.claude/rules/versioning-changelog.md`, `.claude/rules/report-generation.md`, `.claude/rules/git-conventions.md`.

## Цель

Проверить алерты на живом сервисе, синхронизировать документацию и версию 1.5.1 и подготовить коммит.

## Объём и чек-лист

- [ ] Post-code: lint, build, unit и E2E зелёные (`/post-code`)
- [ ] Аудит безопасности и рефакторинга (`/audit-security`) по `src/alerts/` и всем точкам вызова; отдельно — нет ли секретов в `details`; после правок повторный post-code
- [ ] Аудит ресурсов (`/audit-resources`): очередь, карта дублей, таймеры, ожидание при остановке
- [ ] Smoke локально: старт без переменных алертов — одно предупреждение, сервис работает; старт с `ALERTS_URL` и `ALERTS_API_KEY` — алерт неполной конфигурации доходит до TechAdminServer (202) и до Telegram-чата алертов
- [ ] Smoke логина — за пользователем на Railway: успешный логин даёт info-алерт с id и username, без телефона
- [ ] Smoke с неверным ключом: одна строка в лог, сервис работает
- [ ] Drift: `CLAUDE.md` — переменные `ALERTS_URL`, `ALERTS_API_KEY`, `ALERTS_SERVICE_NAME`, модуль `src/alerts/` в архитектуре и ключевых файлах; `.claude/rules/architecture.md` — модуль и раскладка; `.claude/rules/runtime-resources.md` — константы алертов; `.claude/rules/telegram.md` — правило: секреты не попадают в алерты (`/audit-drift`)
- [ ] `.claude/hooks/guard-secrets.js` — проверить, нужен ли шаблон для `ALERTS_API_KEY`; правка только с согласия пользователя
- [ ] API-артефакты: REST-контракт сервиса не меняется, `docs/testing/` не трогается
- [ ] Docs: `docs/deployment/` — короткий раздел о переменных алертов на Railway
- [ ] Версия: ветка `r-1.5.1` (создание только с согласия пользователя), `package.json` `version` = `1.5.1`, `CHANGELOG.md` — раздел `[1.5.1]` с сегодняшней датой и пунктом об алертах
- [ ] `reflect.md` и отчёт через `/plan-report`, строка в `docs/reports/README.md`, ссылка из индекса плана
- [ ] Подготовка коммита по `.claude/rules/git-conventions.md`; коммит только по запросу пользователя

## Команды проверки

- `rtk npm.cmd run lint`
- `rtk npm.cmd run build`
- `rtk npm.cmd test`
- `rtk npm.cmd run test:e2e`
- `rtk npm.cmd run start:dev` (smoke)

## Критерии приёмки

- Все команды зелёные, smoke-алерт виден в TechAdminServer со статусом доставки `sent`.
- Аудит безопасности без находок уровня high и выше.
- Отчёт существует и связан из индекса.
- Три проверки версии пройдены.
