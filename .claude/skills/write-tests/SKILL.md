---
name: write-tests
description: Author tests for a module, file, or recent change via the dedicated test-writer agent
---

# /write-tests

## Instructions

Delegate test authoring to the `test-writer` agent (`.claude/agents/test-writer.md`), which enforces the mandatory coverage policy in `.claude/rules/testing.md`.

1. Determine the scope from `$ARGUMENTS` (file, module, route). If omitted, use `rtk git diff` and `rtk git status` to find recently changed source files and confirm the scope with the user.
2. Launch the `test-writer` agent with the scope and the relevant source files.
3. The agent writes Jest unit specs (`*.spec.ts`) and Supertest E2E specs (`test/*.e2e-spec.ts`) covering happy paths, error and exception branches, edge cases, and DTO validation.
4. The agent mocks the GramJS client and uses fake credentials; it never opens a real MTProto connection and never edits production code to force a pass.
5. Run `rtk npm test` (and `rtk npm run test:e2e` when E2E specs changed); report results, failures first.
6. If the agent reports a production-code discrepancy (a real bug surfaced by a test), hand it to `tg-parser-backend-expert` to fix — the test author does not patch production code.

## Output

- Test files created or updated and the scenarios covered
- Test run results, failures first
- Remaining coverage gaps or production-code discrepancies found

## Arguments

- `$ARGUMENTS` — target module, file path, route, or glob. If omitted, derive from the current diff.
