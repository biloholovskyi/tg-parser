# Security Audit — block-03-05-telegram-service (uncommitted changes)

Date: 2026-09-23
Auditor: security-auditor (read-only)
Checklist: `.claude/rules/refactor-security-audit.md` (security pass), `.claude/rules/telegram.md`, `.claude/rules/runtime-resources.md`
Scope: `git diff HEAD` of `src/telegram/telegram.service.ts`, `src/telegram/telegram.controller.ts`, `src/config/telegram.config.ts`, `src/shared/exceptions/too-many-requests.exception.ts`, `src/telegram/interfaces/message.interface.ts`, `.eslintrc.js`; new files `src/telegram/constants.ts`, `src/telegram/utils/*`, `src/no-console.spec.ts`, `src/config/telegram.config.spec.ts`, `src/telegram/telegram.service.spec.ts`; test and docs fixtures touched by the change.
No MTProto connection was opened, and the service was not run.

Tags: [NEW] means this change introduced it. [CARRIED] means it existed at `HEAD` and is still present.

## Closed by this change (verified)

These were open after the 2026-09-23 block-02 audit. They are now closed.

- CRITICAL: session-string prefix and length logged. All `console.*` calls are removed from `src/`. `src/no-console.spec.ts` and the ESLint `no-console` override enforce this, and the service spec checks that no 8-character session prefix appears in the log.
- HIGH: raw MTProto text in 400/500 bodies. The old `Authentication failed: ${errorMessage}` and `Failed to get posts: ${error.message}` responses are gone. Every failure now goes through `toHttpException` (`src/telegram/utils/telegram-errors.ts:78-101`), which returns only fixed messages.
- HIGH: phone numbers and raw error objects logged. The auth log lines are now fixed strings (`Auth: code sent`, `Auth: authenticated`, and so on), and error lines use `describeError`.

## Focus checks: results

- `describeError` (`telegram-errors.ts:41-50`) returns the RPC `errorMessage` code, or `name: message` for other errors. In GramJS 2.26.22, `RPCError` builds its message from the code and the request class name only (`node_modules/telegram/errors/RPCBaseErrors.js:6-13`), so it never includes request arguments. The only non-RPC GramJS messages that echo input are `No user has "<username>"` and `Cannot find any entity corresponding to "<string>"` (`node_modules/telegram/client/users.js:408,414`). They echo the channel username, which the route regex has already validated (`src/telegram/dto/messages.dto.ts`). That value is not a credential and cannot carry a newline. The `fs` errors in the file-store helpers include only the path. `StringSession` is built only from a string already in the store. Result: no session string, phone number, code, password or API hash can reach a `Logger` call through `describeError`.
- Channel log line (`telegram.service.ts:361-363`) contains the validated username, `hoursBack`, the post count and the truncation flag. It contains no post payload.
- `failWith` (`telegram.service.ts:488-497`) logs the operation label, the status and the `describeError` result. The labels are `Auth`, `Session check` and `Posts: @<validated username>`, so no label contains the phone number.
- `TelegramConfig` warnings (`src/config/telegram.config.ts:17,20`) name the variable, never its value.
- `toHttpException` never forwards the original message. Nest's `BaseExceptionFilter` answers an `HttpException` with `getResponse()` only, and the project registers no custom filter (`useGlobalFilters`, `APP_FILTER` and `ExceptionFilter` do not appear in `src/`). So `cause` is never serialized. `cause` is kept on 401, 404, 400, 503, 502 and 429 (`TooManyRequestsException` now forwards `{ cause }`). An `HttpException` passes through unchanged.
- Test fixtures use only obvious fakes: `fake-api-hash`, `fake-session`, `fake-log-hygiene-session-value`, `+10000000000` / `+10000000001`, `fake-e2e-api-key`, and `12345` as the API ID. The service spec mocks `fs` (`telegram.service.spec.ts:129-135`), so tests never write into `data/`. The Postman collection and the manual testing doc contain only placeholders.
- `any`: none added. The one remaining `catch (error: any)` is carried (see L3).
- Dependencies: `package.json` and the lockfile are unchanged. `rtk npm audit` still reports 40 advisories (4 low, 15 moderate, 21 high), the same count as the previous audit.

## Findings

### CRITICAL

C1 [CARRIED]: session strings and phone numbers are still written to disk
- Where: `src/telegram/telegram.service.ts:181` (`saveAuthState`, which writes the phone number and phone-code hash), `:231` and `:271` (`saveSession`), and helpers `:515-572` writing `data/auth-states.json` and `data/sessions.json`.
- Attack: anyone who can read the container filesystem, a backup or a volume snapshot gets full account credentials and a list of phone numbers. The auth-state sweep (`:99-108`) walks only the in-memory map. After a restart, file entries are never expired, so phone numbers stay on disk until someone runs step 2 for that exact number. The same helpers do synchronous `fs` calls on the request path (`:193`, `:315`, `:525-572`).
- Remediation: resolve the open decision in `.claude/rules/telegram.md` Known Deviations. Either drop the file store, or move it to an encrypted external store. This change did not extend the store; it only rewrote the logging inside it. `data/` is confirmed git-ignored (`.gitignore:44`).

### HIGH

H1 [CARRIED]: the pending-auth map has no size ceiling, and every entry is a live connected client
- Where: `src/telegram/telegram.service.ts:62` and `:175`. Only a TTL applies (`AUTH_STATE_TTL_MS`); there is no maximum entry count.
- Attack: any API-key holder can cycle distinct phone numbers through `POST /telegram/auth`. Each one opens a connection to Telegram that is kept for up to 10 minutes and sends an SMS through the project API application. The only bound is the per-key and per-phone rate limit, and there is no global cap. This breaks the `.claude/rules/runtime-resources.md` rule that every live-object cache has a ceiling.
- Remediation: add a named maximum for pending auth states. At the ceiling, either reject with 429 or evict the oldest entry and release its client. Add a global rate limit on `POST /telegram/auth`.

### MEDIUM

M1 [NEW]: error classification matches substrings of caller-influenced message text
- Where: `src/telegram/utils/telegram-errors.ts:53-57`, `:60-67`, `:82-99`, which match against `messageOf(error)`. Eviction happens at `src/telegram/telegram.service.ts:336-340` and `:367`.
- Attack: when a username is unoccupied, GramJS throws `No user has "<username>" as username`, echoing the caller's value. The route regex accepts `AUTH_KEY_UNREGISTERED`, `SESSION_REVOKED`, `FLOOD_WAIT_99999` and `ECONNRESET` as channel usernames. Requesting posts for such a "channel" has these effects:
  - The caller's own cached client is destroyed, and the request returns 401 instead of 404.
  - Or the request returns a 429 with a caller-chosen `retryAfterSeconds`.
  - Or it returns a 503.
  - Because of the file store, the next request restores the session from disk. That costs a synchronous file read plus a new MTProto connection and handshake with the same auth key.

  Repeating this lets an authenticated caller force connection churn against Telegram, which can get the account flagged. It also puts false 401, 429 and 503 lines in the logs. The damage is limited to the caller's own session and to the rate limit.
- Remediation: classify on the RPC `errorMessage` code by exact match against the code lists (`INVALID_SESSION_ERRORS`, `CHANNEL_UNAVAILABLE_ERRORS`, `AUTH_INPUT_ERRORS`, flood pattern on the code). Match on message text only for the two known GramJS entity-resolution prefixes, anchored at the start. Evict only when the RPC code itself is an invalid-session code. Add a regression test that uses a username equal to an invalid-session code.

M2 [NEW]: Telegram throttling codes that are not `FLOOD_WAIT_X` fall through to 502
- Where: `src/telegram/utils/telegram-errors.ts:100`, `src/telegram/constants.ts:166-173`.
- Attack: `PHONE_NUMBER_FLOOD`, `PHONE_PASSWORD_FLOOD` and similar codes come back as 502 `Telegram request failed`. Clients and proxies treat 502 as retryable. They keep calling `sendCode` for a number Telegram is already throttling, which spends the API application's reputation and risks a ban. A 502 also looks like an outage, not a limit.
- Remediation: map `*_FLOOD` codes to 429 (without a wait value when Telegram gives none), or to a distinguishable 400. Add them to the table in `.claude/rules/telegram.md`, and add mapping tests.

M3 [CARRIED]: a wrong SMS code or wrong 2FA password destroys the pending auth state
- Where: `src/telegram/telegram.service.ts:283-290`. The outer catch releases the client and deletes the state for every error, including `PHONE_CODE_INVALID` and `PASSWORD_HASH_INVALID`.
- Attack: every typo forces a new step 1, which means a new SMS. That multiplies SMS spend on the project API application and moves the number toward `PHONE_NUMBER_FLOOD`.
- Remediation: keep the state when the error is an auth-input error the user can correct. Cap retries with a named attempt limit, and release the state on that limit or on the TTL.

### LOW

L1 [NEW]: a 429 thrown by the service carries no `Retry-After` header
- Where: `src/telegram/utils/telegram-errors.ts:84-86`. Compare `src/shared/utils/rate-limit-response.ts:11`, where the guard's 429 does set the header.
- Effect: the wait is in the body (`retryAfterSeconds`), so the `.claude/rules/telegram.md` rule is met. But the same status code has two contracts, and generic clients ignore the body.
- Remediation: set the header from `retryAfterSeconds` for every `TooManyRequestsException`, for example in a small filter, or document the difference in `docs/testing/`.

L2 [NEW]: `PHONE_NUMBER_BANNED` returns a distinguishable message
- Where: `src/telegram/constants.ts:172`.
- Attack: any API-key holder can test whether an arbitrary number is banned by Telegram. Each probe also spends a `sendCode` attempt.
- Remediation: map it to the same message as `PHONE_NUMBER_INVALID`, unless the user explicitly decides the signal is needed.

L3 [CARRIED]: `catch (error: any)` is still in the sign-in block
- Where: `src/telegram/telegram.service.ts:239-241`. `error.message.includes(...)` throws a `TypeError` for a non-`Error` rejection, which then maps to 502. The change edited this block but kept the `any`.
- Remediation: use `unknown`, and test the RPC `errorMessage` against `SESSION_PASSWORD_NEEDED`.

L4 [CARRIED]: missing API credentials return 502, not the table's 500, on the session paths
- Where: the credential check exists only in `authenticate` (`src/telegram/telegram.service.ts:148-150`). `getClient` (`:315-320`) restores a client with `apiId: 0`, and the failure surfaces as 502 or 503.
- Remediation: check the config before creating any client (`missingConfigException`).

L5 [NEW and CARRIED]: function-length and nesting limits from `.claude/rules/patterns.md` are exceeded
- `authenticate`, `src/telegram/telegram.service.ts:137-299` [CARRIED, touched by this change]: about 160 lines, nesting depth 5. Well past the refactor threshold of 30.
- `walkChannel`, `:376-405` [NEW]: about 28 lines.
- `toHttpException`, `src/telegram/utils/telegram-errors.ts:78-101` [NEW]: about 22 lines.
- Remediation: split `authenticate` into `requestCode`, `signIn` and `checkPassword`, with one cleanup helper. The nesting in this function is also why the error path for M3 is hard to see.

L6 [CARRIED]: callers can interfere with each other's auth flows
- Where: `src/telegram/telegram.service.ts:157-162`. Pending state is keyed by phone number only and is not tied to the API key that started it.
- Attack: a second key holder can run step 1 for a number that is mid-login. That destroys the first caller's pending client and sends a new SMS.
- Remediation: key the pending state by API key plus the normalized phone number.

L7 [CARRIED]: the public `disconnect()` has no caller, and it does not trim the session string the way `getClient` does
- Where: `src/telegram/telegram.service.ts:502-505`.
- Remediation: remove it, or wire it to a route, trim the input, and cover it with the perimeter tests.

L8 [NEW]: the timeout label `'Connection'` is repeated
- Where: `src/telegram/telegram.service.ts:127` and `:330`.
- Remediation: extract a named constant.

## Verdict

This change is a clear security improvement. It closes the carried CRITICAL (session-prefix logging) and two carried HIGH findings (raw MTProto text in responses, and phone numbers in logs). It introduces nothing at CRITICAL or HIGH. The new MEDIUM findings (M1, M2) are bounded by caller authentication and rate limits, and should be fixed before the block is closed.

The service is still not safe to keep publicly exposed as it stands, for carried reasons: C1 (credentials and phone numbers on disk) and H1 (no ceiling on pending auth clients, and no global cap on SMS-sending auth). The block-02 open items not covered here are unchanged: counters kept per process, phone subject not normalized, stale root-level docs, and the 40 npm advisories.
