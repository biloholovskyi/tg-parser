# Phase 04 — Finalize

Статус: todo

Требуемые правила: `.claude/rules/post-code-workflow.md`, `.claude/rules/refactor-security-audit.md`, `.claude/rules/drift-audit.md`, `.claude/rules/versioning-changelog.md`, `.claude/rules/report-generation.md`

## Цель

Модуль разделён, режим компилятора строгий, вопрос хранилища закрыт — и всё это подтверждено проверками и живым запуском.

## Объём (чеклист закрытия, один гейт)

- [ ] Post-code: `rtk npm run lint && rtk npm run build && rtk npm test`
- [ ] Проверка типов: `rtk npm run typecheck`
- [ ] Аудит рефакторинга и безопасности через агент `security-auditor`: подтверждено отсутствие учётных данных на диске
- [ ] Аудит ресурсов через агент `resource-leak-auditor`: владение клиентом не потерялось при перемещении кода
- [ ] Дымовой прогон: полный цикл авторизации и выборка постов на поднятом сервисе
- [ ] Проверка дрейфа через агент `docs-drift-auditor`: правила, `CLAUDE.md` и ADR описывают одно и то же
- [ ] Артефакты ручного тестирования обновлены, если форма ответа изменилась
- [ ] Версия и CHANGELOG синхронизированы
- [ ] Reflect и отчёт о завершении плана через агент `report-writer`
- [ ] Подготовка к коммиту без выполнения коммита

## Команды проверки

- `rtk npm run lint`
- `rtk npm run build`
- `rtk npm run typecheck`
- `rtk npm test`
- `rtk npm run test:e2e`

## Критерии приёмки

- Отчёты обоих аудиторов без открытых находок уровня CRITICAL.
- Дымовой прогон подтверждает работу полного цикла авторизации после перемещения кода.
- Отчёт о завершении существует и связан строкой в `docs/reports/README.md`.
