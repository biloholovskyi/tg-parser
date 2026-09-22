---
name: typecheck
description: Run TypeScript type checking only (no emit) for tg-parser
---

# /typecheck

## Instructions

- Run `rtk npm run typecheck`. If the script is missing, fall back to `rtk npx tsc --noEmit`.
- Report errors grouped by file.
- Remember the compiler is permissive here (`strictNullChecks: false`, `noImplicitAny: false`): a clean typecheck does not mean the code is null-safe. Call out nullable-access risks you notice in changed code.
- Do not propose tightening `tsconfig.json` as part of an unrelated task (`.claude/rules/typescript.md`).

## Arguments

- `$ARGUMENTS` — unused.
