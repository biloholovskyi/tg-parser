---
name: test
description: Run Jest unit tests for tg-parser
---

# /test

## Instructions

- Run `rtk npm test` — Jest unit tests.
- For E2E: `rtk npm run test:e2e`.
- For coverage: `rtk npm run test:cov`.
- Report failures first; for each failing test include the file path and the specific assertion failure.
- Do NOT skip or `.only` tests. Propose real fixes.
- If a test hangs, treat it as a finding: it usually means a real MTProto connection or an open timer, both of which violate `.claude/rules/testing.md`.

## Arguments

- `$ARGUMENTS` — optional test name pattern or file path; pass as `-- -t "<pattern>"` or `-- <file>` to Jest.
