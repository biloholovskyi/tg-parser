---
name: typecheck
description: Run TypeScript type checking only (no emit) for tg-parser
---

# /typecheck

## Instructions

- Run `rtk npm run typecheck`. If the script is missing, fall back to `rtk npx tsc --noEmit`.
- Report errors grouped by file.
- The compiler runs with `strictNullChecks` and `noImplicitAny` on; still call out non-null assertions (`!`) and `any` casts in changed code that hide a missing-value case.
- Do not propose tightening `tsconfig.json` as part of an unrelated task (`.claude/rules/typescript.md`).

## Arguments

- `$ARGUMENTS` — unused.
