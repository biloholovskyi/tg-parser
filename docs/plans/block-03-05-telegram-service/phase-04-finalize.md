# Phase 04 — Finalize

Статус: todo

Требуемые правила: `.claude/rules/post-code-workflow.md`, `.claude/rules/refactor-security-audit.md`, `.claude/rules/drift-audit.md`, `.claude/rules/api-contracts.md`, `.claude/rules/versioning-changelog.md`, `.claude/rules/report-generation.md`

## Цель

Утечка закрыта, ответы честны, логи чисты — и это подтверждено измерением, а не утверждением.

## Объём (чеклист закрытия, один гейт)

- [ ] Post-code: `rtk npm run lint && rtk npm run build && rtk npm test`
- [ ] Аудит ресурсов через агент `resource-leak-auditor`: отчёт подтверждает потолок, TTL, отключение при вытеснении, снятые таймеры, явные опции GramJS
- [ ] Аудит рефакторинга и безопасности через агент `security-auditor`
- [ ] Дымовой прогон: сервис поднят, выборка за короткое и длинное окно, проверка признака обрезки, журнал просмотрен на отсутствие персональных данных
- [ ] Проверка дрейфа через агент `docs-drift-auditor`: раздел о модели сессий в `CLAUDE.md` и константы в `.claude/rules/runtime-resources.md` соответствуют коду
- [ ] Артефакты ручного тестирования в `docs/testing/` отражают новую форму ответа и новые коды состояния
- [ ] Версия и CHANGELOG синхронизированы
- [ ] Reflect и отчёт о завершении плана через агент `report-writer`
- [ ] Подготовка к коммиту без выполнения коммита

## Команды проверки

- `rtk npm run lint`
- `rtk npm run build`
- `rtk npm test`
- `rtk npm run test:e2e`

## Критерии приёмки

- Отчёт агента `resource-leak-auditor` не содержит открытых находок уровня CRITICAL.
- Дымовой прогон подтверждает, что число живых клиентов не растёт после обслуживания нескольких сессий.
- Отчёт о завершении существует и связан строкой в `docs/reports/README.md`.
