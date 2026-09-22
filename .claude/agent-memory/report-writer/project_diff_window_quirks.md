---
name: diff-window-quirks
description: How to measure the Affected files section in this repo — the plan base is usually uncommitted HEAD, untracked files are invisible to diff --stat, and the .claude config migration pollutes CLAUDE.md/package.json counts
metadata:
  type: project
---

В этом репозитории работа по плану обычно ещё не закоммичена на момент отчёта, поэтому база окна — это `HEAD`, и размеры берутся из `rtk git diff --stat HEAD`. Два следствия, которые надо учитывать в разделе Affected files:

- Новые файлы, не добавленные в индекс git (untracked), в `diff --stat` не появляются вовсе. Их размер указывается как число строк (`wc -l`) с пометкой untracked, иначе файл просто пропадёт из отчёта. В отчёте `block-01-bootstrap-1.4.0-2026-09-22.md` так было с `tsconfig.build.json`, `test/auth.e2e-spec.ts` и оба артефакта `docs/testing/`.
- Незакоммиченная миграция конфигурации `.claude/` лежит в том же окне и раздувает числа по `CLAUDE.md` и `package.json`. Разделение видно только по сравнению `git diff --stat --cached` (миграция) и `git diff --stat` (правки плана); построчно разнести их нельзя, поэтому число приводится как есть с оговоркой.

**Why:** правило `.claude/rules/report-generation.md` запрещает оценочные числа, а наивный `diff --stat` здесь одновременно теряет новые файлы и приписывает плану чужие строки.

**How to apply:** перед заполнением Affected files всегда проверять `git status --porcelain` по списку файлов плана и сравнивать `--cached` с обычным diff, если в окне есть незакоммиченные чужие изменения.

Формат индекса: `docs/reports/README.md` — таблица с колонками Дата, Компонент, Версия, Отчёт, порядок от новых к старым. Пустой индекс несёт строку-заглушку `| — | — | — | пока нет отчётов |`, которую первая реальная строка заменяет, а не дополняет.
