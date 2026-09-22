---
paths:
  - "src/main.ts"
  - "src/app.module.ts"
  - "src/**/*.controller.ts"
  - "src/**/dto/**/*"
---
# API Perimeter Security

Mission: the public REST surface of this service controls a real Telegram user account, so every endpoint is treated as a privileged operation, not as a read-only API.

This rule owns the perimeter: who may call the service, how often, and how credentials travel. Input validation, logging hygiene and secret handling inside the code are owned by `.claude/rules/patterns.md` and `.claude/rules/telegram.md`.

## Threat Model (why this rule exists)

- `POST /telegram/auth` makes Telegram send an SMS to an arbitrary number using this project's `TELEGRAM_API_ID`. An unprotected endpoint turns the service into an SMS relay and gets the API application banned.
- A `sessionString` is a bearer credential for a full user account. Anyone who observes one owns the account until the session is revoked.
- Every unauthenticated request costs money: process time, Telegram-side rate budget, and log volume.

## Constants

- AUTH_HEADER = `x-api-key` (service-level caller authentication)
- SESSION_HEADER = `x-session-string` (never a query parameter)
- RATE_LIMIT_AUTH = 5 requests per phone number per hour
- RATE_LIMIT_DEFAULT = 60 requests per caller per minute
- CORS_MODE = explicit origin allowlist from env, never a wildcard
- REQUEST_BODY_MAX_BYTES = 16 * 1024

## Hard Rules

- No endpoint other than the health probe is reachable without AUTH_HEADER. A missing or wrong key is 401, with no detail about which part failed.
- The health probe stays unauthenticated, returns a constant payload, and touches no Telegram state.
- A `sessionString` travels in SESSION_HEADER or a request body, never in a path, a query string, or a redirect. URLs reach proxy logs, platform logs, browser history and referrers.
- `POST /telegram/auth` is rate limited by phone number at RATE_LIMIT_AUTH, independently of the caller's key, because the cost is charged to the Telegram application, not to the caller.
- Every other endpoint is rate limited at RATE_LIMIT_DEFAULT per API key.
- CORS follows CORS_MODE. A wildcard origin on a service that accepts account credentials is forbidden.
- A global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted` and `transform` is wired through `src/shared/utils/http-pipeline.ts`, called from `src/main.ts`, and every request DTO carries `class-validator` decorators. A DTO without decorators is not validation, it is a type annotation erased at runtime.
- Phone numbers, channel usernames and time windows are validated by format and range before any MTProto call.
- Error responses never disclose whether a phone number is registered, whether a session exists, or any raw MTProto text.

## Credential Handling

- API keys and origin allowlists are read through a loader in `src/config/`, never inline from `process.env`.
- A `sessionString` is never written to disk, never logged at any level, never placed in a URL, and never returned by any endpoint except the auth flow that issued it. Truncating or taking a prefix of it is still logging it.
- Phone numbers are personal data: never logged, never persisted, never used as a filename or a JSON key in a stored artifact.
- A session known to be compromised or revoked is evicted from the cache immediately.

## Checklist for a New or Changed Endpoint

- [ ] Requires AUTH_HEADER, or is the health probe
- [ ] Rate limit chosen and stated
- [ ] Credentials travel in headers or the body, never in the URL
- [ ] Request DTO with `class-validator` decorators, covered by a validation test
- [ ] Failure modes mapped to explicit HTTP statuses per `.claude/rules/telegram.md`
- [ ] No secret and no personal data reachable by any log statement on the path
- [ ] Manual test artifacts updated per `.claude/rules/api-contracts.md`

## Anti-Patterns

- An endpoint that triggers Telegram work without caller authentication
- `sessionString` as a query parameter
- Wildcard CORS
- Relying on an unregistered `ValidationPipe` or on DTOs without decorators
- Rate limiting only by API key on an endpoint whose cost lands on the Telegram account
- Error messages that differentiate "unknown number" from "wrong code"
- Storing any credential in a file the repository can reach

## Related Rules

- `.claude/rules/telegram.md` — secret hygiene and Telegram error mapping
- `.claude/rules/architecture.md` — where validation is wired
- `.claude/rules/runtime-resources.md` — cost of unbounded callers
- `.claude/rules/api-contracts.md` — contract changes and manual test artifacts
- `.claude/rules/refactor-security-audit.md` — audit checklist
