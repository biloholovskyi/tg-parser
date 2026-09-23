---
paths:
  - "src/**/*"
  - "railway.toml"
---
# Runtime Resources, Cost and Environment

Mission: every resource this service opens has an owner, a ceiling and a release path, because the deployment is billed by the time and memory the process occupies.

A leaked resource here is not a latency problem, it is a recurring bill: a `TelegramClient` left connected keeps a socket and pings Telegram every PING_INTERVAL_S forever, for as long as the process lives.

## Constants

- SESSION_CACHE_MAX_ENTRIES = 50
- SESSION_CACHE_IDLE_TTL_MS = 30 * 60 * 1000 (evict and disconnect an idle client)
- SESSION_CACHE_SWEEP_INTERVAL_MS = 5 * 60 * 1000
- AUTH_STATE_TTL_MS = 10 * 60 * 1000
- AUTH_STATE_SWEEP_INTERVAL_MS = 5 * 60 * 1000
- EXTERNAL_CALL_TIMEOUT_MS = 30_000
- FLOOD_SLEEP_THRESHOLD_S = 5 (GramJS default is 60 and must be overridden)
- CONNECTION_RETRIES_COUNT = 3 (GramJS default is Infinity)
- REQUEST_RETRIES_COUNT = 3
- RETRY_DELAY_MS = 1000
- POSTS_PAGE_SIZE = 100
- POSTS_MAX_MESSAGES = 1000 (walk ceiling per request; beyond it the response sets `isTruncated`)
- Location: SESSION_CACHE_MAX_ENTRIES through POSTS_MAX_MESSAGES are defined in `src/telegram/constants.ts`
- PING_INTERVAL_S = 9 (GramJS internal, per connected client — not configurable)
- RUNTIME_INSTANCE_COUNT = 1 (the in-memory session cache has no cross-instance affinity)
- RUNTIME_FILESYSTEM = ephemeral (reset on every deploy and restart)

## Resource Ownership (hard)

- Every cache of live objects declares a maximum size and an idle TTL. A `Map` that only grows is a defect, not a cache.
- Every entry evicted from a cache of connections is disconnected as part of the eviction, not left to the garbage collector.
- Every path that creates a `TelegramClient` names the code path that disconnects it, including every error branch and the shutdown hook.
- Every `setInterval` and `setTimeout` is cleared on the path that settles it; a timer that outlives its request is a leak. Long-lived intervals call `unref()`.
- Every external call carries EXTERNAL_CALL_TIMEOUT_MS, and the timer for that timeout is cleared once the call settles.
- Shutdown (`onModuleDestroy` / shutdown hooks) disconnects every cached client and clears every interval.

## GramJS Client Baseline

Client options are set explicitly from named constants, never left at library defaults:

- `floodSleepThreshold` = FLOOD_SLEEP_THRESHOLD_S. The default silently sleeps inside the request for up to a minute; the caller pays for that time and the rule in `.claude/rules/telegram.md` requires a 429 instead.
- `connectionRetries` and `requestRetries` are bounded, never `Infinity`.
- Reconnect behaviour is explicit; a cached client that has been evicted must not keep reconnecting.
- One client per `sessionString`, never one per request.

## Hot Path Discipline

- No synchronous filesystem call (`readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync`) on any request path. Synchronous I/O blocks the single Node event loop for every concurrent caller.
- Read-modify-write of a whole state file per request is forbidden; state that must survive a request belongs in memory or in a real store.
- No unbounded iteration over Telegram history: the ceiling is a named constant and a truncated result is reported to the caller, never silently returned as complete.

## Process Stability

- A single unhandled rejection must not kill the process. Log it with the NestJS `Logger` and keep serving; GramJS emits background rejections on ordinary network faults.
- `process.exit` belongs only in a deliberate shutdown path, never in a generic error handler.
- A crash loop is a cost event: every restart empties the session cache and forces every caller to re-authenticate, which multiplies Telegram-side auth traffic.

## Environment Constraints

- The filesystem is RUNTIME_FILESYSTEM. Anything written to disk disappears on the next deploy, so disk is never a correctness dependency and never a session store.
- The service runs with RUNTIME_INSTANCE_COUNT instances. Adding instances is an architecture decision, not a config change, because the session cache is per-process.
- The health endpoint stays cheap and dependency-free so the platform probe cannot be blocked by Telegram.
- Log volume is a billed resource. Log the outcome of an operation, not its progress; per-item or per-iteration logging is forbidden outside a debug level that is off by default.

## Review Questions

Ask these of any change that touches the session cache, the client lifecycle, or an external call:

- What evicts this entry, and what disconnects the client when it is evicted?
- What is the maximum number of live clients this code can produce?
- Which timer does this path create, and where is it cleared?
- If Telegram is slow or rate-limiting, how long can one HTTP request occupy the process?
- How many log lines does one request emit under normal load?

## Anti-Patterns

- An unbounded `Map` of clients, sessions, or auth states
- Eviction without disconnect
- A created client with no disconnect path on an error branch
- Library defaults for flood-wait, retry, or reconnect behaviour
- Synchronous filesystem access inside a request
- `process.exit` in an `unhandledRejection` or `uncaughtException` handler
- Treating the deployment filesystem as durable
- Per-message or per-iteration log lines in production code

## Related Rules

- `.claude/rules/telegram.md` — client lifecycle and error mapping
- `.claude/rules/architecture.md` — session model
- `.claude/rules/patterns.md` — async, timeout and observability patterns
- `.claude/rules/api-security.md` — perimeter limits that cap how much work a caller can request
- `.claude/rules/refactor-security-audit.md` — audit checklist
