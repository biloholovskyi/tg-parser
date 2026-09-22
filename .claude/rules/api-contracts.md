---
paths:
  - "src/**/*.controller.ts"
  - "src/**/dto/**/*.ts"
  - "src/**/interfaces/**/*.ts"
  - "docs/testing/**/*"
---
# API Contracts and Test Artifacts

Governs REST contract changes and the manual test artifacts that ship with them.

## Constants

- TESTING_ARTIFACTS_DIR = `docs/testing/`
- TESTING_ARTIFACTS_MD = `{component}-manual-testing.md`
- TESTING_ARTIFACTS_POSTMAN = `{component}-postman-collection.json`

## When Required

Required whenever a change adds or modifies REST endpoints, or changes a request/response contract (new fields, new status codes, changed validation). In planned work this is a Finalize checklist item — see `.claude/rules/implementation-plans.md`.

## Artifacts

- TESTING_ARTIFACTS_MD — Markdown with preconditions, the auth model (how a `sessionString` is obtained and supplied), and a case table covering the happy path, regression, and every error branch (validation 400, 401, 404, 429).
- TESTING_ARTIFACTS_POSTMAN — importable Postman collection (v2.1.0): self-contained, with an auth folder that runs the multi-step `POST /telegram/auth` flow and stores the resulting `sessionString` in a collection variable, the new or changed requests, and negative cases.

## Rules

- Reuse the format of existing `docs/testing/*` artifacts for consistency.
- For a change to an already-covered component, either add a dedicated `{component}-...` pair or extend the existing pair — never leave the artifacts stale.
- Verify the JSON parses (import-safe).
- Response shapes are declared as interfaces in `interfaces/`; a route never returns an undocumented ad-hoc object literal shape.
- A `sessionString` captured during manual testing is a real credential: store it in a Postman variable, never hardcode it into a committed collection.

## Anti-Patterns

- Adding or changing REST endpoints without the matching test artifacts.
- A Postman collection that depends on manual environment setup to run.
- A committed collection containing a real `sessionString`, phone number, or API hash.

## Related Rules

- `.claude/rules/architecture.md` — the REST surface
- `.claude/rules/telegram.md` — error mapping for Telegram failures
- `.claude/rules/testing.md` — automated coverage policy
