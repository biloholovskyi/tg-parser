# Security Audit — 2026-09-23

Scope: the REST perimeter after `docs/plans/block-02-api-perimeter/` (caller authentication, rate
limits, session credential moved out of the URL).
Checklists: `.claude/rules/api-security.md`, `.claude/rules/telegram.md`,
`.claude/rules/refactor-security-audit.md` (security pass), `.claude/rules/runtime-resources.md`.

Audited files: `src/shared/guards/*.ts`, `src/shared/utils/{rate-limit-store,api-key-header,session-header,rate-limit-response,http-pipeline,process-handlers}.ts`,
`src/shared/decorators/*.ts`, `src/shared/exceptions/too-many-requests.exception.ts`,
`src/shared/constants/{rate-limit,http}.constants.ts`, `src/config/{api-keys,cors,telegram}.config.ts`,
`src/telegram/{telegram.controller,telegram.module,telegram.service}.ts`, `src/telegram/dto/*`,
`src/app.module.ts`, `src/main.ts`, `test/app.e2e-spec.ts`,
`docs/testing/telegram-manual-testing.md`, `docs/testing/telegram-postman-collection.json`,
`.gitignore`, tracked repository files and git history.

No code was changed. No credential value is reproduced anywhere in this report.
`rtk npm audit` at audit time: 40 advisories (0 critical, 21 high, 15 moderate, 4 low).

## What block 02 closed

Stated first, because it changes the shape of the threat model relative to the 2026-09-22 audit.

- `ApiKeyGuard`, `RateLimitGuard` and `PhoneRateLimitGuard` are registered as `APP_GUARD` in
  `src/telegram/telegram.module.ts:14-16`. `APP_GUARD` is application-scoped regardless of the declaring
  module, so the three guards cover every route of every future module, not only `TelegramModule`.
  Registration order is execution order: authentication runs before any counter is touched.
- The only route carrying `@PublicRoute()` is `health` (`src/telegram/telegram.controller.ts:31-36`), and
  the marker sits on the handler, not on the class. `@PhoneRateLimited()` sits on the `auth` handler
  (`src/telegram/telegram.controller.ts:47`). There is exactly one `@Controller` in `src/`, so no route
  escapes the guards.
- `sessionString` now travels in `x-session-string` (`src/shared/utils/session-header.ts:8-12`,
  `src/shared/decorators/session-string.decorator.ts:7-9`). The posts route is bound to
  `ChannelPostsParamsDto` and `GetPostsQueryDto` (`src/telegram/telegram.controller.ts:81-82`), so with
  `forbidNonWhitelisted` a `?sessionString=` query is rejected with 400 — the carried CRITICAL of
  2026-09-22 and the open HIGH-1 (`GetPostsDto` bound to no route) are both closed.
- Key comparison is length-checked then `timingSafeEqual`, over every configured key without an early
  exit (`src/shared/guards/api-key.guard.ts:43-59`). 401 and 429 bodies are constant
  (`UNAUTHORIZED_MESSAGE`, `TOO_MANY_REQUESTS_MESSAGE`) and disclose nothing but a retry delay.
- An empty `API_KEYS` closes every authenticated route instead of opening the service
  (`src/config/api-keys.config.ts:18-26`); an empty `CORS_ALLOWED_ORIGINS` denies all browser origins and
  a literal `*` is stripped (`src/config/cors.config.ts:40-52`).
- The committed manual-test artifacts hold no credential: `phoneNumber`, `phoneCode`, `password`,
  `sessionString` and `apiKey` are empty Postman variables, and the phone numbers in
  `docs/testing/telegram-manual-testing.md` are reserved placeholders. `/data/` and `.env` are
  git-ignored and have never been committed on any branch.

The perimeter itself is sound. The findings below are what remains.

---

## CRITICAL

### CRITICAL-1 — a prefix of every issued session string is written to stdout

- File: `src/telegram/telegram.service.ts:197`, `src/telegram/telegram.service.ts:252`
  (with the length at `:193` and `:248`).
- Every successful authentication logs the first 20 characters of every session string currently in the
  cache, plus the length of the new one. `.claude/rules/telegram.md` (Hard Rules) and
  `.claude/rules/api-security.md` (Credential Handling) both state that a prefix or a length is still
  logging the credential.
- Attack: Railway retains stdout. Anyone with log access — a platform account, a shipped log drain, a
  support ticket with a pasted log — collects credential material for every account that ever
  authenticated. A 20-character prefix also shortens any offline attack on a captured session.
- Remediation: delete lines 192-198 and 245-253 outright. If cache-size telemetry is wanted, log
  `this.clients.size` alone through the NestJS `Logger`, never a key or a length.
- Pre-existing, not introduced by block 02. It is CRITICAL regardless of which block owns it.

### CRITICAL-2 — session strings and phone numbers are persisted in plaintext JSON

- File: `src/telegram/telegram.service.ts:478-543` (`saveSession`, `loadSessions`, `saveAuthState`,
  `loadAuthStates`, `deleteAuthState`), written to `data/sessions.json` and `data/auth-states.json`
  (paths at `:25-27`).
- `data/sessions.json` is a plaintext list of full account credentials. `data/auth-states.json` uses the
  phone number as the JSON key and stores the `phoneCodeHash` next to it. This is the Known Deviation in
  `.claude/rules/telegram.md`; the rule forbids both ("never write it to a file", "never used as a
  filename or a JSON key in a stored artifact").
- Attack: any path traversal, any misconfigured static handler, any backup or image export, any
  `docker cp`, any future log-and-dump of the working directory yields every account the service has
  ever held. `/data/` being git-ignored limits this to credentials at rest, not repository exposure.
- Effect on the perimeter verdict: block 02 made the credential hard to observe in transit. This makes it
  easy to observe at rest, which cancels most of that gain. The perimeter cannot be declared safe while
  the store exists.
- Remediation: drop the file-backed store (the deployment filesystem is wiped on every deploy, so it buys
  nothing), or move to an encrypted external store. This is the open user decision recorded under Known
  Deviations — it needs a decision, not more deferral.

---

## HIGH

### HIGH-1 — no cap on what one caller key can spend on the Telegram application

- Files: `src/shared/constants/rate-limit.constants.ts:7-16`,
  `src/shared/guards/phone-rate-limit.guard.ts:19-23`, `src/shared/utils/rate-limit-store.ts:64-69`.
- `RATE_LIMIT_AUTH` (5/hour) is per phone number. `RATE_LIMIT_DEFAULT` (60/min) is per caller key. There
  is no limit on `POST /telegram/auth` as a whole, so one valid key can drive roughly 3,600 auth calls
  per hour, each to a fresh number, each an SMS charged to `TELEGRAM_API_ID`.
- The per-phone counter is additionally evictable. `enforceCeiling` drops the oldest entry once the store
  reaches `RATE_LIMIT_STORE_MAX_ENTRIES` (1000), and the auth window is one hour, so 1000 distinct
  numbers flush a target number's window and reset its budget. FIFO eviction of a security counter means
  the limit degrades exactly under the load it exists to stop.
- Attack: one leaked or shared API key turns the service into a bulk SMS relay and gets the Telegram
  application banned — the precise outcome the threat model in `.claude/rules/api-security.md` names.
- Remediation: add a third counter — a global limit on `POST /telegram/auth` per process, sized to
  plausible legitimate use — and make the phone store refuse to evict an unexpired window (reject the new
  subject, or fail closed, rather than dropping a live counter).

### HIGH-2 — raw MTProto error text is returned to the caller and signals account existence

- File: `src/telegram/telegram.service.ts:288`, `src/telegram/telegram.service.ts:416`.
- `Authentication failed: ${errorMessage}` and `Failed to get posts: ${error.message}` forward the GramJS
  message verbatim. That message is the Telegram error string: `PHONE_NUMBER_UNOCCUPIED`,
  `PHONE_NUMBER_BANNED`, `PHONE_CODE_INVALID`, `PHONE_CODE_EXPIRED`, `SESSION_PASSWORD_NEEDED`,
  `FLOOD_WAIT_X`, and so on.
- `.claude/rules/api-security.md` Hard Rules: "Error responses never disclose whether a phone number is
  registered, whether a session exists, or any raw MTProto text." The anti-pattern "error messages that
  differentiate 'unknown number' from 'wrong code'" is reproduced literally.
- Attack: an authenticated caller enumerates which phone numbers have Telegram accounts at 60 probes per
  minute, and learns the internal state of the service from its error strings.
- Remediation: map the Telegram conditions to the fixed statuses and fixed messages in the error table of
  `.claude/rules/telegram.md`, keep the original as `cause` for the log, and return one indistinguishable
  message for every "phone/code did not work" branch.

### HIGH-3 — phone numbers and full error objects reach stdout

- File: `src/telegram/telegram.service.ts:56`, `:102`, `:161` (phone number interpolated into a log line);
  `:264` (`console.error('Authentication error:', error)` — the whole GramJS error object);
  `:400-402` (message and stack).
- Phone numbers are personal data under `.claude/rules/telegram.md` and must never be logged. The dumped
  GramJS error object carries the request it failed on, which on the auth path includes the phone number
  and the `phoneCodeHash`.
- Remediation: remove the phone number from all three log lines, and replace the raw dumps with the
  `describeError` pattern already used in `src/shared/utils/process-handlers.ts:67-73` (name and message
  only), through the NestJS `Logger` rather than `console.*`.

### HIGH-4 — root-level documentation still instructs callers to put the session string in the URL

- Files: `README.md:130`, `USAGE.md:117`, `USAGE.md:184`, `HOW_TO_USE_API.md:127`, `HOW_TO_USE_API.md:189`,
  `QUICKSTART.md:62`, `START_HERE.md:135`, `TODO_FOR_USER.md:135`, `FIX_2FA_ERROR.md:161`,
  `PROJECT_STRUCTURE.md:117`, `pln.md:210` (the last one also states the posts route "should work without
  authorization").
- These are tracked files that document the pre-block-02 contract. None of them mentions `x-api-key`.
- Attack: this is not a code defect, it is an instruction to the operator to leak the credential. A user
  following `README.md` puts a full account credential into a URL, where it lands in proxy logs, platform
  logs and shell history — and the request then fails with 400, so the credential is spent for nothing.
  The values shown are placeholders, so there is no committed secret.
- Remediation: update or delete these documents in the same change that ships block 02. `docs/testing/`
  is already correct; the root-level set is not.

---

## MEDIUM

### MEDIUM-1 — the per-phone budget is consumed by requests that never send an SMS

- File: `src/shared/guards/phone-rate-limit.guard.ts:27-49`.
- Guards run before pipes, so the counter is incremented before `ValidationPipe` and before any decision
  to call Telegram. A body of `{"phoneNumber":"<victim>","x":1}` is rejected 400 by
  `forbidNonWhitelisted` yet still burns one of the victim's five hourly slots.
- Attack: an authenticated caller locks a specific phone number out of the auth flow with five cheap
  requests per hour, sending no SMS and leaving no Telegram-side trace.
- Secondary effect of the same placement: steps 2 and 3 of a normal login (code, then 2FA password) also
  consume the budget, so a legitimate user gets one full 2FA login plus one retry per hour.
- Remediation: count the phone subject where the SMS is actually ordered — after validation, on the
  `sendCode` branch — or run the guard as an interceptor that only commits the increment when step 1 is
  reached.

### MEDIUM-2 — the phone rate limit is defeated by reformatting the number

- Files: `src/shared/guards/phone-rate-limit.guard.ts:53-62`, `src/telegram/dto/auth.dto.ts:13`.
- The subject is the raw trimmed string. `PHONE_NUMBER_PATTERN` accepts both `+<digits>` and `<digits>`,
  and Telegram treats them as the same subscriber, so the same number yields two independent counters and
  twice the SMS budget.
- Remediation: normalize to digits only before hashing in the guard, and apply the same normalization to
  the value handed to GramJS so the counted subject and the dialled subject are identical.

### MEDIUM-3 — an unauthenticated flood writes one warning line per request

- File: `src/config/api-keys.config.ts:18-26`, called per request from
  `src/shared/guards/api-key.guard.ts:32`.
- `getApiKeysConfig()` re-reads and re-parses `process.env` on every request, and emits `logger.warn` on
  every request while `API_KEYS` is empty. `ApiKeyGuard` runs before `RateLimitGuard`, and the rate limit
  is keyed on the API key anyway, so an anonymous flood is not throttled at all.
- Attack: log-volume amplification against a metered platform, plus event-loop cost, from an
  unauthenticated caller. `.claude/rules/runtime-resources.md` requires bounded log volume.
- Remediation: resolve the config once at module initialization (inject it), keep the empty-keys warning
  as a single boot-time line, and add an IP-keyed counter ahead of `ApiKeyGuard` for rejected callers.

### MEDIUM-4 — rate-limit state is per process, so limits reset on every deploy and split under scaling

- File: `src/shared/guards/rate-limit.guard.ts:20-24`, `src/shared/guards/phone-rate-limit.guard.ts:19-23`.
- Counters live in the guard instance. A Railway deploy or a crash-restart zeroes the SMS budget for
  every phone number, and a second instance would give each caller a full budget per instance. This is
  the same single-process assumption as the session cache, now load-bearing for a security control.
- Remediation: state the single-instance constraint explicitly next to the deployment configuration, and
  treat any move to more than one replica as a design change that needs shared counter storage.

### MEDIUM-5 — 21 high-severity advisories in the dependency tree

- File: `package.json` (`@nestjs/*` pinned at `^10`), verified with `rtk npm audit`.
- Runtime-reachable: `express` / `body-parser` / `qs` / `path-to-regexp` — including "body-parser
  vulnerable to denial of service when invalid limit value silently disables size enforcement"
  (the project passes a numeric limit at `src/shared/utils/http-pipeline.ts:15-16`, so it is not hit
  today, but the body-size ceiling depends on that detail) and a `path-to-regexp` ReDoS that needs
  multiple route parameters (the only parameterised route has one). The rest are build-time
  (`@nestjs/cli`, `@typescript-eslint/*`, `webpack`, `js-yaml`, `lodash`, `minimatch`).
- Every runtime fix is gated behind `@nestjs/core` / `@nestjs/platform-express` 12, a major bump. Count is
  up from 13 at the 2026-09-22 audit.
- Remediation: schedule the Nest 10 → 12 upgrade as its own block with its own `risks.md`; until then
  this is an accepted, dated risk, not an unknown one.

### MEDIUM-6 — synchronous filesystem calls on the request path

- File: `src/telegram/telegram.service.ts:488-489`, `:500`, `:510`, `:518-519`, `:529`, `:539`, reached
  from `getClient` (`:305`) and `authenticate` (`:138`, `:149`, `:189`, `:242`).
- `readFileSync` / `writeFileSync` block the event loop on every cache miss and every auth step, and both
  files grow without bound. `.claude/rules/runtime-resources.md` forbids synchronous filesystem access on
  a request path.
- Attack: an authenticated caller stalls the whole process — including the health probe — by driving
  cache misses against a large `sessions.json`.
- Remediation: resolved by CRITICAL-2. Removing the store removes this finding.

---

## LOW

### LOW-1 — the health probe is unauthenticated and unlimited

- File: `src/telegram/telegram.controller.ts:31-36`; `src/shared/guards/rate-limit.guard.ts:34-36` returns
  early for public routes.
- Required by the rule (the probe must stay open) and the payload is constant with no Telegram access, so
  the cost is a bare HTTP round trip. Still the one path an anonymous caller can hold open indefinitely.
- Remediation: a generous IP-keyed limit in front of the probe, or leave it to the platform edge. Record
  the choice either way.

### LOW-2 — a body without `Content-Length` is not covered by the size ceiling

- File: `src/shared/utils/http-pipeline.ts:25-38`.
- `enforceContentLengthLimit` reads the `content-length` header; a chunked request has none, `Number(undefined)`
  is `NaN`, and the check passes. For `application/json` and `urlencoded` the parser limit still applies, so
  the gap is a chunked body with a content type no parser claims — which is never read by a handler.
- Remediation: reject a request whose `transfer-encoding` is chunked and whose content type no parser
  claims, or add a catch-all raw parser with the same limit. Carried from 2026-09-22 and narrowed by the
  new middleware, not eliminated.

### LOW-3 — the negative Postman test sends a real session variable in a URL

- File: `docs/testing/telegram-postman-collection.json:677` (request "P4 session string in the query is
  refused").
- The case is correct and the committed variable is empty, but a tester who has populated
  `{{sessionString}}` will send their live credential through the URL to prove that the URL is refused.
  The proof does not require a real value.
- Remediation: use a literal dummy in the query of that one request; keep `{{sessionString}}` in the
  header.

### LOW-4 — `@PublicRoute()` is effective at class level and nothing prevents that

- Files: `src/shared/guards/api-key.guard.ts:21-24`, `src/shared/guards/rate-limit.guard.ts:29-32`.
- Both guards use `getAllAndOverride` over `[handler, class]`, so one decorator on a controller class
  would silently open every route in it. Correct today; a one-line mistake away from not being.
- Remediation: document the handler-only intent in the decorator, and add a test asserting that the set
  of routes reachable without `x-api-key` is exactly `GET /telegram/health`.

### LOW-5 — fixed-window counters allow a double burst at the boundary

- File: `src/shared/utils/rate-limit-store.ts:40-56`.
- A caller can spend the full allowance at the end of one window and again at the start of the next —
  120 requests in a couple of seconds against `RATE_LIMIT_DEFAULT`.
- Remediation: a sliding window, or accept it explicitly given that the ceiling exists mainly to bound
  Telegram-side cost.

### LOW-6 — `console.warn` in the Telegram config loader

- File: `src/config/telegram.config.ts:13`, `:16`.
- No secret is printed (only the variable names), but `.claude/rules/refactor-security-audit.md` requires
  the NestJS `Logger` and no `console.*` in committed code. `src/config/api-keys.config.ts` and
  `src/config/cors.config.ts` already do this correctly.
- Remediation: switch both lines to a `Logger` instance, matching the other two loaders.

### LOW-7 — parsed channel content is committed to the repository

- Files: `posts_data/*.json` (five files, ~872 KB tracked).
- Output of the parser: public-channel post text, ids and timestamps. No credential and no account
  identifier, but it is third-party content carried in the repository for no stated reason, and it is the
  kind of artifact that quietly starts holding private-channel payloads.
- Remediation: delete from the working tree and add `posts_data/` to `.gitignore`, as `/data/` already is.

---

## Verdict

Not safe to expose publicly as it stands — but for a different reason than on 2026-09-22.

Block 02 did its job. The two carried CRITICALs it owned are closed: every route except the health probe
now requires `x-api-key`, every route except the health probe is rate limited, the session credential
travels in a header and a query-string credential is rejected, the guards are application-scoped and
correctly ordered, and the 401 and 429 responses are constant. The service is no longer an open SMS
relay, which was the single worst property it had. The perimeter work itself carries no CRITICAL finding.

What blocks the verdict is everything behind the perimeter:

- The credential is still written to stdout as a prefix on every successful auth (CRITICAL-1) and to a
  plaintext file on disk (CRITICAL-2). A perimeter that protects a credential in transit while the same
  credential is printed to the platform log is not a net protection.
- One valid API key still buys thousands of SMS per hour on the project's Telegram application (HIGH-1),
  because the only limit that constrains Telegram spend is per phone number and that counter is evictable.
- The auth endpoint still answers "this number has no account" in plain text (HIGH-2).
- The repository's own root documentation still tells operators to put the session string in a URL (HIGH-4).

Minimum to change the verdict: CRITICAL-1 and HIGH-3 (delete the logging — a small, contained change),
a decision on CRITICAL-2, HIGH-1 (a global cap on the auth route plus non-evictable live windows), and
HIGH-2 (fixed error mapping). HIGH-4 is documentation and costs nothing.

Until then: keep the service reachable only from a known client with a strong `API_KEYS` value, treat
every session string it has ever issued as potentially disclosed through the logs, and do not run it with
more than one replica — the rate limits are per process.
