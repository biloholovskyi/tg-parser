---
paths:
  - "src/**/*.ts"
  - "test/**/*.ts"
---
# Testing Policy

Mission: all functionality must be covered by tests. No feature or bugfix is complete until its tests exist and pass.

## Non-Negotiable Rules

- Every new public service method has a unit test.
- Every controller route (`@Get/@Post/@Put/@Patch/@Delete`) has at least one test.
- Every bugfix ships with a regression test that fails before the fix and passes after.
- Every request DTO has validation tests: at least one happy path and one rejection case.
- Every error branch that maps a Telegram failure to an HTTP status has a test (see the error table in `.claude/rules/telegram.md`).
- Every cache or client lifecycle path has a test: hit, miss, eviction, and that eviction disconnects (`.claude/rules/runtime-resources.md`).
- Every endpoint has a test proving it rejects an unauthenticated caller, except the health probe (`.claude/rules/api-security.md`).
- A change that adds or modifies functionality is not done until `rtk npm test` passes for it.

## Dedicated Test Author

- Tests are written by the `test-writer` agent (`.claude/agents/test-writer.md`).
- The main agent or `tg-parser-backend-expert` may scaffold a test file, but substantive test authoring is delegated to `test-writer`.
- `test-writer` writes tests only; it never modifies production code to make a test pass.

## Tests in Planned Work

- Tests ship inside the feature phase, in the same change as the code they cover.
- Do NOT create a separate gated test phase by default; add one ONLY when test volume is large enough to warrant its own gate.
- See Complexity Tier in `.claude/rules/implementation-plans.md`.

## Coverage Targets

- Unit >= 0.8 (TEST_COVERAGE_UNIT_TARGET in `.claude/rules/patterns.md`)
- Integration / E2E >= 0.7
- New code must not lower the existing coverage ratio.

## Test Layout

- Unit specs: co-located `*.spec.ts` next to the source file.
- E2E specs: `test/*.e2e-spec.ts` against a bootstrapped NestJS app via `supertest`, configured by `test/jest-e2e.json`.
- One `describe` per class or route group; AAA (Arrange-Act-Assert) per `it`.

## Mocking Guidelines (critical for this project)

- Mock GramJS: never construct a real `TelegramClient` and never open an MTProto connection in a test. Mock the `telegram` package or inject a fake client through the service boundary.
- Never use a real `sessionString`, phone number, API id, or API hash in a test fixture; use obvious fakes.
- E2E tests bootstrap the Nest app with `TelegramService` overridden by a mock provider — a real E2E run must not hit Telegram.
- Mock timers rather than sleeping when testing backoff or flood-wait handling.
- Do not mock fast pure libraries (`class-validator`) — run them.
- No `.only` / `.skip` left in committed tests.

## Manual Test Artifacts (API changes)

- Any change that adds or modifies REST endpoints or request/response contracts also ships manual test artifacts in `docs/testing/` — see `.claude/rules/api-contracts.md`.

## Workflow Hook

- After implementing functionality, run the `test-writer` agent (or `/write-tests`) before `/post-code`.
- `/post-code` (`.claude/rules/post-code-workflow.md`) must show a passing `rtk npm test` before commit.
- Coverage gaps are audited via `.claude/rules/test-coverage-audit.md`.

## Anti-Patterns

- Committing a feature with no tests, or with a `// TODO: add tests` marker.
- Tests that assert nothing, or only assert that no error was thrown when behavior is testable.
- Disabling or skipping tests to get a green run.
- Opening a real MTProto connection, or using a real credential, in any test.
- Production code edited by the test author to force a pass.

## Related Rules

- `.claude/rules/patterns.md` — testing patterns (AAA, naming, mocks)
- `.claude/rules/telegram.md` — what must be mocked and why
- `.claude/rules/test-coverage-audit.md` — coverage gap analysis
- `.claude/rules/post-code-workflow.md` — quality gates
