---
paths:
  - "src/telegram/**/*"
  - "src/config/telegram.config.ts"
---
# Telegram / GramJS

Mission: keep every MTProto interaction inside the `src/telegram/` services, treat session strings and API credentials as secrets, and fail with explicit HTTP statuses instead of leaking Telegram internals.

MTProto is Telegram's own wire protocol; GramJS speaks it as a user account (not a bot), so this service has the reach and the rate limits of a real user.

## Constants

- API_CREDENTIAL_ENV = `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`
- SESSION_CACHE = in-memory `SessionClientCache<TelegramClient>` keyed by `sessionString` (`src/telegram/utils/session-client-cache.ts`), owned by `SessionStore` (`src/telegram/session-store.ts`)
- SESSION_PERSISTENCE = none (process memory only) — decided in `docs/plans/block-08-09-refactor-strictness-storage/adr-session-storage.md`
- AUTH_STEPS = phone number, SMS code, optional 2FA password
- FLOOD_WAIT_ERROR = `FLOOD_WAIT_X` (seconds to wait carried in the error)
- CLIENT_OPTION_BASELINE = explicit GramJS options from named constants (`.claude/rules/runtime-resources.md`)
- SESSION_TRANSPORT = request header, never a query string (`.claude/rules/api-security.md`)

## Hard Rules

- All GramJS imports and all `TelegramClient` construction stay inside `src/telegram/`. No other module imports `telegram` or `telegram/sessions`.
- A `sessionString` is a full account credential. Never log it (a prefix or a length is still logging it), never include it in an error message, never write it to a file, never place it in a URL, never return it from an endpoint other than the auth flow that issued it.
- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` are read only through `src/config/telegram.config.ts`, never inline from `process.env` elsewhere.
- Never log phone numbers, SMS codes, 2FA passwords, or full message payloads of private channels.
- Do not add a persistence layer, a file-backed session store, or a cache library without an explicit user decision — the in-memory model is a deliberate constraint, documented in `.claude/rules/architecture.md`.

## Known Deviations (open decisions)

State the deviation, never silently rewrite the rule around it. Resolution protocol: `.claude/rules/drift-audit.md`.

- None open. The former file-backed session store was removed by user decision (ADR `docs/plans/block-08-09-refactor-strictness-storage/adr-session-storage.md`): sessions and pending logins live in memory only, nothing is written under `data/`, and `data/` stays git-ignored.

## Client Lifecycle

- Reuse the cached client for a given `sessionString`; creating a second client for the same session causes Telegram-side auth churn.
- Every code path that creates a client must also have a path that disconnects it; leaked connections are the known failure mode of this service.
- Check connection state before issuing a request and reconnect explicitly rather than assuming a cached client is still live.
- On unrecoverable session errors (revoked session, auth key invalid) evict the entry from SESSION_CACHE so the next call re-authenticates cleanly.
- A restart empties SESSION_CACHE. Code must behave correctly when a supplied `sessionString` has no cached client.
- The cache is bounded and idle entries are evicted and disconnected. Sizes, TTLs and the GramJS option baseline live in `.claude/rules/runtime-resources.md`.
- Every connected client pings Telegram continuously, so an un-evicted client is a permanent running cost, not idle memory.

## Error Mapping

| Telegram condition | HTTP response |
|--------------------|---------------|
| Missing `sessionString` header on the posts route | 400 `BadRequestException` |
| `sessionString` unknown to this process (not cached) | 401 `UnauthorizedException` |
| Session revoked, auth key invalid, not authorized | 401 `UnauthorizedException` |
| Channel not found or not accessible to this account | 404 `NotFoundException` |
| Phone code or phone number invalid, 2FA password wrong | 400 `BadRequestException` with a distinguishable message |
| `FLOOD_WAIT_X` | 429, surface the wait duration; never silently sleep for a long wait |
| Transport failure (timeout, not connected, connection reset or refused) | 503 `ServiceUnavailableException` |
| Any other Telegram failure | 502 `BadGatewayException` with a fixed message |
| Missing `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | 500 with a configuration message, raised at use time, not at boot |

- The mapping lives in `toHttpException` in `src/telegram/utils/telegram-errors.ts`; the error-code lists are in `src/telegram/constants.ts`.
- `GET /telegram/me` answers 200 `failed` only when the session is missing, unknown or rejected; a transport failure or flood wait is thrown as its mapped status (503, 429), because it is not a verdict on the session.
- Preserve the original error with `cause` when wrapping; do not swallow GramJS errors.
- Never return a raw GramJS error object or stack to the client.

## Rate Limits and Iteration

- Message iteration over a channel is paginated by GramJS; keep an explicit upper bound on how many messages a request may walk, expressed as a named constant.
- Time-window filtering is applied while iterating, so iteration stops as soon as messages fall outside the window — do not fetch the whole history and filter afterwards.
- Treat flood waits as expected, not exceptional: back off, report, and do not retry in a tight loop.
- Never run unbounded parallel requests against Telegram with the same account.

## Configuration

- Boot must not fail when credentials are absent — the health endpoint stays up so the platform health check passes; the failure surfaces on first real use.
- Every new env var is documented in `CLAUDE.md` under Environment and read through a loader in `src/config/`.

## Anti-Patterns

- GramJS imports outside `src/telegram/`
- Logging a `sessionString`, phone number, code, or 2FA password
- Creating a `TelegramClient` per request instead of reusing the cached one
- Leaving a client connected after an error path
- Retrying immediately on `FLOOD_WAIT_X`
- Returning raw MTProto errors to the HTTP caller
- Assuming a session survives a restart
- Reading `process.env.TELEGRAM_*` outside the config loader

## Related Rules

- `.claude/rules/api-security.md` — perimeter auth, rate limits, credential transport
- `.claude/rules/runtime-resources.md` — cache ceilings, client options, cost of open connections
- `.claude/rules/drift-audit.md` — resolving a deviation between this rule and the code
- `.claude/rules/architecture.md` — module layout and session model
- `.claude/rules/patterns.md` — async, retry, and error-handling patterns
- `.claude/rules/refactor-security-audit.md` — secret-hygiene checklist
- `.claude/rules/testing.md` — GramJS must be mocked in unit tests
