# Phase 04 — Finalize

Статус: done (кроме smoke на настоящем TechAdminServer и решения по hook — за пользователем)

Правила: `.claude/rules/post-code-workflow.md`, `.claude/rules/refactor-security-audit.md`, `.claude/rules/drift-audit.md`, `.claude/rules/versioning-changelog.md`, `.claude/rules/report-generation.md`, `.claude/rules/git-conventions.md`.

## Цель

Проверить алерты на живом сервисе, синхронизировать документацию и версию 1.5.1 и подготовить коммит.

## Объём и чек-лист

- [x] Post-code: lint, build, unit и E2E зелёные (`/post-code`)
- [x] Аудит безопасности и рефакторинга (`/audit-security`) по `src/alerts/` и всем точкам вызова; отдельно — нет ли секретов в `details`; после правок повторный post-code
- [x] Аудит ресурсов (`/audit-resources`): очередь, карта дублей, таймеры, ожидание при остановке
- [ ] Smoke локально: старт без переменных алертов — одно предупреждение, сервис работает (сделано); старт с `ALERTS_URL` и `ALERTS_API_KEY` — алерт неполной конфигурации доходит до TechAdminServer (202) и до Telegram-чата алертов (сделано с локальным поддельным сервером; настоящий TechAdminServer — за пользователем)
- [ ] Smoke логина — за пользователем на Railway: успешный логин даёт info-алерт с id и username, без телефона
- [x] Smoke с неверным ключом: одна строка в лог, сервис работает (проверено юнит-тестом, не на живом сервисе)
- [x] Drift: `CLAUDE.md` — переменные `ALERTS_URL`, `ALERTS_API_KEY`, `ALERTS_SERVICE_NAME`, модуль `src/alerts/` в архитектуре и ключевых файлах; `.claude/rules/architecture.md` — модуль и раскладка; `.claude/rules/runtime-resources.md` — константы алертов; `.claude/rules/telegram.md` — правило: секреты не попадают в алерты (`/audit-drift`)
- [ ] `.claude/hooks/guard-secrets.js` — проверить, нужен ли шаблон для `ALERTS_API_KEY`; правка только с согласия пользователя
- [x] API-артефакты: REST-контракт сервиса не меняется, `docs/testing/` не трогается
- [x] Docs: `docs/deployment/` — короткий раздел о переменных алертов на Railway
- [x] Версия: ветка `r-1.5.1` (создание только с согласия пользователя), `package.json` `version` = `1.5.1`, `CHANGELOG.md` — раздел `[1.5.1]` с сегодняшней датой и пунктом об алертах
- [x] `reflect.md` и отчёт через `/plan-report`, строка в `docs/reports/README.md`, ссылка из индекса плана
- [x] Подготовка коммита по `.claude/rules/git-conventions.md`; коммит только по запросу пользователя

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

## Доказательства

- Lint и build без ошибок; unit: 62 набора, 1321 тест; E2E: 5 наборов, 68 тестов — после всех исправлений по аудитам.
- Аудит безопасности: 0 critical и 0 high; M1 (редирект с ключом) и M2 (узкий санитайзер) исправлены, на них есть регрессионные тесты.
- Аудит ресурсов: утечек нет. Исправлены: подавление повторов до проверки очереди, ложные алерты при деплое (`beginShutdown`), ожидание запроса Grok при остановке, шторм алертов по каналам.
- Smoke: сборка стартует без алертов с одним предупреждением, а с локальным поддельным сервером уходят два настоящих `POST /alerts` с `X-API-Key`; ключа в логах нет. Проверка с неверным ключом покрыта юнит-тестом (одна строка `Alert not delivered: HTTP 401` за окно).
- Не сделано, за пользователем: smoke с настоящим TechAdminServer и настоящим логином; решение по шаблону `ALERTS_API_KEY` в `.claude/hooks/guard-secrets.js`.
- Версия 1.5.1 во всех трёх местах, ветка `r-1.5.1`.
