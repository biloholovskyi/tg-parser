# Phase 04 — Finalize

Статус: todo

Требуемые правила: `.claude/rules/post-code-workflow.md`, `.claude/rules/refactor-security-audit.md`, `.claude/rules/drift-audit.md`, `.claude/rules/api-contracts.md`, `.claude/rules/versioning-changelog.md`, `.claude/rules/report-generation.md`

## Цель

Периметр закрыт, подтверждён живым запуском и описан для потребителей.

## Объём (чеклист закрытия, один гейт)

- [ ] Post-code: `rtk npm run lint && rtk npm run build && rtk npm test`
- [ ] Аудит безопасности через агент `security-auditor`; вердикт о допустимости публичного размещения приложен
- [ ] Дымовой прогон: запрос без ключа отклонён, запрос с ключом обслужен, превышение лимита даёт 429, строка сессии принимается заголовком
- [ ] Проверка дрейфа через агент `docs-drift-auditor`
- [ ] Артефакты ручного тестирования и коллекция запросов в `docs/testing/` отражают новый контракт
- [ ] Новые переменные окружения описаны в `CLAUDE.md`
- [ ] Версия и CHANGELOG синхронизированы
- [ ] Reflect и отчёт о завершении плана через агент `report-writer`
- [ ] Подготовка к коммиту без выполнения коммита

## Команды проверки

- `rtk npm run lint`
- `rtk npm run build`
- `rtk npm test`
- `rtk npm run test:e2e`

## Критерии приёмки

- Отчёт агента `security-auditor` не содержит открытых находок уровня CRITICAL по периметру.
- Дымовой прогон подтверждает отказ неаутентифицированному вызывающему на каждом непубличном маршруте.
- Отчёт о завершении существует и связан строкой в `docs/reports/README.md`.
