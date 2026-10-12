# Security and Refactor Audit — 2026-09-22

Scope: the changes of `docs/plans/block-01-bootstrap/` (Finalize checklist item of `phase-03-finalize.md`).
Checklists: `.claude/rules/refactor-security-audit.md` (security pass), `.claude/rules/api-security.md`,
`.claude/rules/runtime-resources.md`, `.claude/rules/patterns.md`, `.claude/rules/telegram.md`.

Audited files: `src/main.ts`, `src/app.module.ts`, `src/config/cors.config.ts`,
`src/shared/constants/http.constants.ts`, `src/shared/utils/http-pipeline.ts`,
`src/shared/utils/process-handlers.ts`, `src/telegram/dto/auth.dto.ts`,
`src/telegram/dto/messages.dto.ts`, `src/telegram/telegram.controller.ts` (one line),
the new specs under `src/` and `test/app.e2e-spec.ts`.

No code was changed. `rtk npm test` at audit time: 7 suites, 59 tests, green.
`rtk npm audit` reviewed (see MEDIUM-8). No credential value is reproduced anywhere in this report.

## Carried risks (not introduced by block 01 — do not fix here)

These dominate the verdict, so they are stated before the new findings.

- CRITICAL (deferred to block 02). No endpoint requires `x-api-key` and none is rate limited:
  `POST /telegram/auth`, `GET /telegram/me`, `GET /telegram/channel/:channelUsername/posts`
  (`src/telegram/telegram.controller.ts:40, 58, 78`). Any anonymous caller can make Telegram send an
  SMS to an arbitrary number on this project's API application (SMS relay, application ban) and can
  spend the account's rate budget. `.claude/rules/api-security.md`, Hard Rules 1 and 4.
- CRITICAL (deferred to block 02). `sessionString` travels as a query parameter on two GET routes
  (`src/telegram/telegram.controller.ts:61, 81`); the space-to-plus workarounds at lines 66 and 89 are
  direct evidence of URL mangling. A full account credential therefore reaches proxy logs, platform logs
  and browser history. `.claude/rules/api-security.md`, Credential Handling.
- CRITICAL (open decision). The file-backed store writes session strings to `data/sessions.json` and
  phone numbers with code hashes to `data/auth-states.json` using synchronous `fs` on the request path
  (`src/telegram/telegram.service.ts:478-543`). `/data/` is correctly git-ignored (`.gitignore`), so this
  is credentials at rest on an ephemeral disk, not repository exposure.
- HIGH (deferred). `console.*` in `src/telegram/telegram.service.ts` logs a phone number (lines 56, 102,
  161) and the length of a session string (lines 193, 248). Under `.claude/rules/telegram.md` a length is
  still logging the credential, and a phone number is personal data. Also `console.*` in
  `src/config/telegram.config.ts:13, 16`.

## Findings introduced or left open by block 01

### HIGH-1 — the new posts DTO is never wired, so the posts route stays unvalidated

- Files: `src/telegram/dto/messages.dto.ts:7-17`, `src/telegram/telegram.controller.ts:78-99`
- `GetPostsDto` is referenced only by its own spec (`src/telegram/dto/messages.dto.spec.ts`). The handler
  still takes `@Param('channelUsername')`, `@Query('sessionString')` and `@Query('hoursBack')` as raw
  primitives. The global `ValidationPipe` does not validate primitive-typed parameters (metatype `String`
  fails its `toValidate` check), so on this route nothing runs: `channelUsername` reaches `TelegramService`
  and then MTProto with no format check at all, and `hoursBack` is checked by hand at lines 92-97 with the
  literals `24`, `1` and `720` duplicating `HOURS_BACK_DEFAULT` / `HOURS_BACK_MIN` / `HOURS_BACK_MAX`.
- Contradicts `.claude/rules/api-security.md` ("Phone numbers, channel usernames and time windows are
  validated by format and range before any MTProto call"; the anti-pattern "relying on DTOs without
  decorators" applies in effect here — the decorators exist but are unreachable) and
  `.claude/rules/patterns.md` (Validation; magic numbers with 2+ uses).
- Attack / cost: an attacker-chosen `channelUsername` of any length and any character set is passed
  straight into an account-scoped MTProto call; combined with the missing rate limit this is free work
  charged to the Telegram account.
- Remediation: bind `GetPostsDto` with `@Query()` and add a param DTO validating the channel username by
  format, then delete the hand-rolled range check so the constants have a single home. Already planned as
  `docs/plans/block-02-api-perimeter/phase-03-session-transport-dto.md`; until it lands, phase 01's
  evidence line about request DTOs receiving decorators is true only for `auth.dto.ts`.

### MEDIUM-2 — the body size limit is bypassed by any other content type

- File: `src/shared/utils/http-pipeline.ts:13-14`
- `json()` and `urlencoded()` only match `application/json` and `application/x-www-form-urlencoded`. The
  app is created with `bodyParser: false` (`src/main.ts:17`), so no other parser and no other cap exists.
  Verified locally against the installed express/cors versions: a 5 MB `POST` with
  `Content-Type: text/plain` is accepted and answered 200, no 413. `REQUEST_BODY_MAX_BYTES` therefore does
  not apply to every request, which is what `.claude/rules/api-security.md` states as a perimeter constant.
  Validation still rejects such a request afterwards (the pipe sees an empty body), so this is a
  resource-cost issue, not a validation bypass.
- Attack: an anonymous caller (no auth, no rate limit today) streams arbitrarily large non-JSON bodies;
  the platform bills the ingress and the process time.
- Remediation: cap every request before the typed parsers — either a small middleware rejecting
  `content-length > REQUEST_BODY_MAX_BYTES` (and unknown-length bodies) on all routes, or
  `json({ limit, type: () => true })` plus explicit `text`/`raw` parsers sharing the same limit. Add an
  E2E case with a non-JSON content type; `http-pipeline.spec.ts:127-137` covers only JSON.

### MEDIUM-3 — two shutdown paths race on the same signal

- Files: `src/main.ts:24-25`, `src/shared/utils/process-handlers.ts:25-30`
- `app.enableShutdownHooks()` registers Nest's own SIGTERM/SIGINT listener
  (`node_modules/@nestjs/core/nest-application-context.js:187-216`, Nest 10.4.20), which runs
  `callDestroyHook` → `callBeforeShutdownHook` → `dispose` → `callShutdownHook` and then re-raises the
  signal with `process.kill(process.pid, signal)`. `registerProcessHandlers` adds a second listener that
  calls `app.close()`, which runs the same lifecycle hooks. One SIGTERM therefore starts two concurrent
  shutdown sequences: lifecycle hooks can execute twice, and Nest's re-raised signal (its own listener
  already removed, ours consumed by `process.once`) hits the default action and can terminate the process
  before `closeApplication` reaches its deliberate `process.exit(EXIT_CODE_SUCCESS)`.
- Contradicts `.claude/rules/runtime-resources.md` ("`process.exit` belongs only in a deliberate shutdown
  path"): the deliberate path exists but is not necessarily the one that wins. The consequence becomes
  concrete in blocks 03-05, where `onModuleDestroy` will disconnect cached GramJS clients — double
  execution or an aborted disconnect means Telegram-side session churn on every deploy.
- Remediation: pick one owner. Either drop `enableShutdownHooks()` and keep the explicit handlers, or keep
  `enableShutdownHooks()` and register only `unhandledRejection` / `uncaughtException`. Add a test
  asserting exactly one SIGTERM listener on a real bootstrapped app — `process-handlers.spec.ts:91-97`
  asserts one listener per event but never calls `enableShutdownHooks`, so the duplication is invisible.

### MEDIUM-4 — the shutdown path has no ceiling and no re-entry guard

- File: `src/shared/utils/process-handlers.ts:20-46`
- `closeApplication` awaits `app.close()` with no timeout. `close()` waits for the HTTP server to close,
  which waits for open keep-alive connections; after an `uncaughtException` the process state is already
  unreliable. If `close()` never settles, the process stays alive after a fatal error and keeps answering
  `GET /telegram/health` with a constant 200, so the platform probe never restarts it — a silent half-dead
  instance, which is the hidden-degradation mode named in `risks.md`.
- Two concurrent uncaught exceptions call `closeApplication` twice: two `app.close()` runs and two
  `process.exit` calls.
- Remediation: race `app.close()` against a named `SHUTDOWN_TIMEOUT_MS` timer created with `.unref()` and
  force the exit when it fires; add an `isShuttingDown` flag so a second entry returns immediately.

### MEDIUM-5 — unbounded error-log volume from background rejections

- File: `src/shared/utils/process-handlers.ts:16-18`
- Every GramJS background rejection now produces one `error` line and the process survives. GramJS emits
  these on ordinary network faults, so a reconnect storm produces an unbounded stream of log lines for the
  lifetime of the process. `.claude/rules/runtime-resources.md` states log volume is a billed resource and
  forbids per-item logging outside a debug level that is off by default.
- Remediation: dedupe or rate-limit (a counter plus one line per interval), and give the operator a signal
  other than log count — `risks.md` already predicts a rising count of error records without restarts as
  the only symptom.

### MEDIUM-6 — the new auth DTO rejects empty-string optional fields that the old contract accepted

- Files: `src/telegram/dto/auth.dto.ts:14-25`, `src/telegram/telegram.service.ts:95`
- `@IsOptional()` in `class-validator` skips validation only for `null` and `undefined`. A caller sending
  an empty-string `phoneCode` now fails `@Matches(PHONE_CODE_PATTERN)` and an empty-string `password`
  fails `@IsNotEmpty()`, so both return 400. The service treats a falsy `phoneCode` as "step 1, request
  the code" (`telegram.service.ts:95`), i.e. the previous meaning of a blank field was "absent", not
  "invalid".
- The repository's own artifact reproduces the break: `docs/testing/telegram-postman-collection.json`
  declares `phoneCode` and `password` as collection variables with empty defaults (lines 20-33), and
  request A3 always renders the `password` field. This is exactly failure mode 1 in `risks.md` (validation
  with `forbidNonWhitelisted` rejecting what a live client sends), and it is not covered by a decision:
  `auth.dto.spec.ts:69, 116` enshrine the rejections without recording that the contract changed for blank
  optional fields.
- Remediation: either normalise an empty string to `undefined` for the optional fields (`@Transform` or
  `@ValidateIf`) so a blank field keeps its old meaning, or declare the break explicitly in the Finalize
  report and in `docs/testing/telegram-manual-testing.md`. Either way add a spec per field for the
  empty-string case.

### MEDIUM-7 — the body-limit control depends on an undeclared dependency

- Files: `src/shared/utils/http-pipeline.ts:4`, `package.json` (dependencies)
- `json`/`urlencoded` are imported from `express`, which is not a declared dependency: only
  `@types/express` (devDependencies) is present, and `express` arrives transitively through
  `@nestjs/platform-express`. The build passes because the types are installed. A hoisting change or a
  Nest major (Nest 11 moves to express 5) can break a perimeter control at runtime rather than at build
  time. `.claude/rules/patterns.md` Dependency Hygiene.
- Remediation: use the framework API `app.useBodyParser('json', { limit: REQUEST_BODY_MAX_BYTES })` on
  `NestExpressApplication` and drop the direct import, or add `express` to `dependencies` pinned to the
  version Nest resolves.

### MEDIUM-8 — known advisories in the dependency tree

- Command: `rtk npm audit --omit=dev` → 13 advisories (6 high, 7 moderate).
- Reachable from this perimeter: `qs` DoS via bracket/comma array parsing (every route takes query
  parameters and `urlencoded` is enabled), `path-to-regexp` < 0.1.13 ReDoS via express routing, the
  `multer` DoS family shipped by `@nestjs/platform-express` despite there being no upload route,
  `body-parser` GHSA-v422-hmwv-36x6 (an invalid `limit` silently disables size enforcement — not triggered
  here, a numeric limit is valid, but it is the same control as MEDIUM-2), `@nestjs/core`
  GHSA-36xv-jgw5-4q75, plus `lodash` via `@nestjs/config` and `fflate` / `file-type` via `telegram`.
- Until block 02 lands there is no rate limit, so every DoS advisory above is reachable anonymously.
- Remediation: all fixes are majors (`@nestjs/*` 12.x). Schedule a dedicated upgrade block; do not fold a
  framework major into this Finalize.

### MEDIUM-9 — raw MTProto text reaches the caller (pre-existing, outside the block)

- File: `src/telegram/telegram.service.ts:288`, `:416`
- Both wrapped messages interpolate the GramJS message verbatim, so conditions such as
  `PHONE_NUMBER_UNOCCUPIED`, `SESSION_REVOKED` or a flood-wait string become response bodies. Contradicts
  `.claude/rules/api-security.md` ("Error responses never disclose whether a phone number is registered
  ... or any raw MTProto text") and `.claude/rules/telegram.md` ("Never return a raw GramJS error object
  or stack to the client").
- Listed for completeness of the error-disclosure checklist item; the fix belongs to the error-mapping work
  of blocks 03-05 (block 02 phase 03 already names the disclosure goal).

### MEDIUM-10 — the changed privileged route has no route-level test

- Files: `src/telegram/telegram.controller.ts` (no `*.spec.ts` exists), `test/app.e2e-spec.ts`
- The block changed the effective request contract of `POST /telegram/auth` (a blank or unknown field now
  yields 400) and the health payload. Only the DTOs in isolation and the health route are covered; nothing
  proves the pipe rejects an unknown extra field on the real route, or that a valid body still reaches
  `TelegramService.authenticate`. `.claude/rules/testing.md` requires at least one test per controller
  route.
- Remediation: extend `test/app.e2e-spec.ts` with auth-route cases against the bootstrapped app with
  `TelegramService` mocked (the mock provider is already in place).

## LOW

- LOW-1 `src/main.ts:27` — `process.env.PORT` is read inline and unvalidated (a non-numeric value
  propagates into `app.listen`), while `cors.config.ts` sets the precedent of a `src/config/` loader per
  `.claude/rules/telegram.md` Configuration. Move it into a loader with a numeric check.
- LOW-2 `src/config/cors.config.ts:39-50` — origin matching is exact string comparison; no lowercasing and
  no trailing-slash normalisation, so a mixed-case or slash-terminated entry silently matches nothing.
  This fails closed (verified: an unmatched or empty allowlist sends no `Access-Control-Allow-Origin`), so
  it is an availability/misconfiguration trap, not permissiveness. Normalise entries and warn per entry
  that is not a valid absolute origin, not only when the list ends up empty (line 28).
- LOW-3 no test pins the fail-closed default at the middleware level. `cors.config.spec.ts` covers the
  loader well (unset, empty, whitespace, trailing separators, wildcard-only), but `http-pipeline.spec.ts`
  exercises only a non-empty allowlist. That an empty origin array denies every browser origin is a
  property of the `cors` package, not of this code — verified manually during this audit, worth a
  regression test.
- LOW-4 `src/shared/utils/http-pipeline.ts:13-16` — CORS is enabled after the body parsers, so a 413 and a
  rejected preflight carry no CORS headers and a browser sees an opaque failure. Cosmetic.
- LOW-5 no security headers: no `helmet`, and Express's `X-Powered-By` is left enabled (nothing calls
  `app.disable('x-powered-by')`). Not mandated by `.claude/rules/api-security.md`; bundle with block 02.
- LOW-6 `src/shared/utils/http-pipeline.ts:24` — global `enableImplicitConversion: true` weakens the very
  decorators it enables: a JSON number in `phoneNumber` is coerced to a string and passes `@IsString()`.
  Useful for query DTOs, broad for the auth body; prefer per-DTO `@Type()`.
- LOW-7 `src/telegram/dto/auth.dto.ts:3` — the phone pattern accepts a number with no leading `+` while
  the message claims E.164, so a 7-digit local number passes validation and fails inside MTProto instead
  of at the boundary. Require the leading `+` or drop the E.164 wording.
- LOW-8 `src/main.ts:34-35` — `process.exit` immediately after `logger.error`; on a piped stdout the write
  can be asynchronous and the startup failure line can be lost. Flush before exiting.
- LOW-9 shutdown does not disconnect cached GramJS clients: no class implements `onModuleDestroy`
  (`src/telegram/telegram.service.ts`), so the new graceful path closes the HTTP server and exits while
  MTProto sockets are still connected. `.claude/rules/runtime-resources.md` requires shutdown to
  disconnect every cached client and clear every interval. Bounded in practice by `process.exit`; the fix
  belongs to blocks 03-05. Phase 02's claim that shutdown hooks run is currently vacuous because no
  shutdown hook exists to run.
- LOW-10 repository hygiene: `posts_data/*.json` (5 tracked files, ~880 KB) hold harvested channel content
  — text, dates and post URLs — committed to git. Checked: no credential, no session string and no real
  phone number in them, and `/data/` is git-ignored. Still, parsed output of channels this account can read
  does not belong in version control and no test uses it. Untrack and ignore. Not introduced by this block.

## Secret hygiene of the new code (pass)

- `src/shared/utils/process-handlers.ts:51-57` (`describeError`) emits only the error name and message for
  an `Error`, the raw string for a string reason, and a fixed fallback for anything else — no stack, no
  request payload, no DTO echo. This satisfies the `risks.md` commitment that error messages are logged
  without the request payload.
- `src/config/cors.config.ts:28, 47` log the variable name only, never its value.
- `src/main.ts:30-31, 34` log the port, the health path and a startup error message.
- Nothing in the new code can reach a `sessionString`, `TELEGRAM_API_HASH`, phone number, SMS code or 2FA
  password. Credentials are still read only through `src/config/`, and no GramJS import appears outside
  `src/telegram/`.
- Residual: `describeError` passes the error message through verbatim, so any future error message that
  interpolates a credential would be logged. `src/telegram/telegram.service.ts` already interpolates phone
  numbers into log lines (carried HIGH above).
- Test fixtures and `docs/testing/` artifacts are clean: obvious fakes only, and the Postman collection
  ships empty values for `phoneNumber`, `phoneCode`, `password` and `sessionString`.

## Verdict

Block 01 is a real improvement to the perimeter: the `ValidationPipe` is genuinely wired and enforced on
the auth body, the CORS allowlist fails closed when unset (verified end to end, wildcard discarded,
credentials disabled), JSON bodies are capped, the duplicate health routes are gone, and a background
rejection no longer restarts the process. No new credential exposure was introduced.

The service is not safe to keep publicly exposed as it stands, and the reason is not block 01: with no
caller authentication, no rate limit, a session string in the query string and session strings written to
disk, any anonymous caller can spend the project's Telegram application on SMS to arbitrary numbers and
can replay any session string they observe in a log. Keep the deployment private or IP-restricted until
block 02 lands. Within block 01's own scope, HIGH-1 and MEDIUM-2 should be tracked explicitly (HIGH-1 is
already covered by block 02 phase 03); MEDIUM-3 and MEDIUM-4 should be fixed before the graceful-shutdown
behaviour is relied upon in blocks 03-05.
