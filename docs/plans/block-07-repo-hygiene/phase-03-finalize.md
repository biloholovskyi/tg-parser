# Phase 03 — Finalize

Статус: todo

Требуемые правила: `.claude/rules/post-code-workflow.md`, `.claude/rules/drift-audit.md`, `.claude/rules/versioning-changelog.md`

## Цель

Репозиторий чист, документы правдивы, версия согласована.

## Объём (чеклист закрытия, один гейт)

- [ ] Post-code: `rtk npm run lint && rtk npm run build && rtk npm test` — подтверждение, что чистка не задела сборку
- [ ] Проверка дрейфа через агент `docs-drift-auditor`: `README.md` и `CLAUDE.md` соответствуют коду
- [ ] Согласование версии, ветки и журнала подтверждено
- [ ] Подготовка к коммиту без выполнения коммита

Тир `small`: отчёт о завершении и `reflect.md` не создаются.

## Команды проверки

- `rtk npm run lint`
- `rtk npm run build`
- `rtk npm test`

## Критерии приёмки

- Сборка и тесты зелёные после удаления файлов.
- Отчёт о дрейфе не содержит расхождений в документах корня.
