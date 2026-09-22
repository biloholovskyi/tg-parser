---
name: post-code
description: Run the standard post-code QA workflow (lint, build, test) for tg-parser
---

# /post-code

Run the standard post-code workflow after any code change.

## Instructions

- Run in order, stop on the first failure:
  1. `rtk npm run lint` — ESLint auto-fix
  2. `rtk npm run build` — compile TypeScript
  3. `rtk npm test` — Jest unit tests
- Confirm new or changed functionality has tests (`.claude/rules/testing.md`); if missing, recommend `/write-tests` or the `test-writer` agent before committing.
- Check the secret-hygiene items in the pre-commit checklist: no `console.log`, no log path reaching a session string or credential.
- Stop on failure and propose fixes before continuing.
- Report results with failures first.
- Follow the full checklist in `.claude/rules/post-code-workflow.md`.
- Never commit; that requires an explicit user request (`.claude/rules/git-conventions.md`).

## Arguments

- `$ARGUMENTS` — optional scope hint (file path or module name); used only to narrow reports, not the commands themselves.
