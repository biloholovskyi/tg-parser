---
paths:
  - "src/**/*"
  - "test/**/*"
---
# Skill: Test Coverage Audit

Use when improving tests for a module or the whole service. Enforces `.claude/rules/testing.md`.

Triggers:
- User asks for test coverage, missing tests, or test improvements
- Before finishing a feature phase
- After a refactor that may have invalidated existing tests

## Process

- Identify the target scope (for example `src/telegram`)
- Compare source files against co-located `*.spec.ts` and `test/*.e2e-spec.ts`
- Find gaps in:
  - Services: each public method should have unit tests
  - Controllers: each route should have at least one test
  - Validators: valid and invalid inputs on every request DTO
  - Error paths: each mapped Telegram failure (`.claude/rules/telegram.md`) and each custom exception
  - Session lifecycle: cache hit, cache miss, evicted session, disconnect on error
  - Config: missing `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` behavior
- Add unit tests for:
  - Services, with GramJS mocked
  - Pure helpers and utilities
  - Business-rule validators
- Add E2E tests for:
  - New REST endpoints, via `supertest` against a bootstrapped Nest app with `TelegramService` overridden
- Verify with:
  - `rtk npm test` — unit tests
  - `rtk npm run test:cov` — coverage report
  - `rtk npm run test:e2e` — E2E tests
- Follow the testing patterns in `.claude/rules/patterns.md` and the policy in `.claude/rules/testing.md`

## Mocking Guidelines

- Mock the GramJS client at the service boundary; never open a real MTProto connection
- Use obviously fake credentials in fixtures — never a real `sessionString`, API id, API hash, or phone number
- Use fake timers for backoff and flood-wait tests instead of real sleeps
- Do not mock `class-validator` or pure utilities — run them

## Output

- Coverage gaps: uncovered public methods and code paths with file paths
- New test files or new `describe`/`it` blocks added
- Coverage command output (line %, branch %, uncovered files)
- Tests run and any failures to address

## Related Rules

- `.claude/rules/testing.md` — mandatory coverage policy
- `.claude/rules/patterns.md` — testing patterns (AAA, naming, mocks)
- `.claude/rules/telegram.md` — error branches that must be covered
- `.claude/rules/post-code-workflow.md` — quality gates
