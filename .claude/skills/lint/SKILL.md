---
name: lint
description: Run ESLint auto-fix for tg-parser
---

# /lint

## Instructions

- Run `rtk npm run lint` — ESLint with auto-fix.
- If errors remain, group them by file and report.
- Suggest `rtk npm run format` (Prettier) if formatting is the main issue.
- Do NOT suppress rules or add inline disables to make errors pass — propose real fixes.

## Arguments

- `$ARGUMENTS` — optional file path or glob; if given, report only errors inside it. The lint command still runs project-wide.
