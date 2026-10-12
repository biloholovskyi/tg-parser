---
name: build
description: Build tg-parser (NestJS / tsc)
---

# /build

## Instructions

- Run `rtk npm run build`.
- Report compile errors grouped by file.
- Do NOT hide errors behind `any` or a cast — propose real fixes following `.claude/rules/typescript.md`.
- For GramJS type mismatches, narrow the MTProto result at the service boundary instead of casting.

## Arguments

- `$ARGUMENTS` — unused. The build is project-wide.
