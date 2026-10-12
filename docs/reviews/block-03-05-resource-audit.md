# Resource Audit — block-03-05-telegram-service (uncommitted changes)

Date: 2026-09-23
Scope: staged + unstaged changes on branch `r-1.4.1` for `docs/plans/block-03-05-telegram-service`: `src/telegram/telegram.service.ts`, `src/telegram/constants.ts`, `src/telegram/utils/session-client-cache.ts`, `src/telegram/utils/with-timeout.ts`, plus the paths they reach (`src/main.ts`, `src/shared/utils/process-handlers.ts`, `src/shared/guards/phone-rate-limit.guard.ts`).
Checklist: `.claude/rules/runtime-resources.md`.
Library verified: `node_modules/telegram` version 2.26.22.

Tags: [NEW] = introduced or made reachable by this change. [PRE] = pre-existing at `HEAD` (aa0176a) and not remediated by this change.

## Verified Library Facts (GramJS 2.26.22)

- Defaults (`node_modules/telegram/client/telegramBaseClient.js:28-48`): `floodSleepThreshold: 60`, `connectionRetries: Infinity`, `requestRetries: 5`, `retryDelay: 1000`, `autoReconnect: true`, `timeout: 10`.
- Logger (`node_modules/telegram/extensions/Logger.js:20`): default level `info`, writes to `console` directly, bypassing the NestJS `Logger`. Only replaced when `baseLogger` is passed (`telegramBaseClient.js:63-68`).
- Update loop (`node_modules/telegram/client/updates.js:18,164-225`): `PING_INTERVAL = 9000` ms, runs `while (!client._destroyed)`; on ping failure it calls `client._sender.reconnect()` and `console.error(err)`; sends `updates.GetState` when idle more than 30 min.
- `destroy()` (`telegramBaseClient.js:190-199`) sets `_destroyed = true` (stops the loop after at most one PING_INTERVAL sleep) and disconnects main and borrowed senders. `disconnect()` alone does not stop the loop. `destroy()` is therefore the correct release call.
- `getMessages` with `limit <= 100` issues one `GetHistory` with `waitTime = 0` (`node_modules/telegram/client/messages.js:34,177-178`).

## Checklist Verdicts

- Session cache ceiling SESSION_CACHE_MAX_ENTRIES with LRU eviction: CONFIRMED. `session-client-cache.ts:51-60` evicts the first Map key (least recently used, recency maintained by `touch` at `:94-98`) while `size >= maxEntries`. Wired at `telegram.service.ts:57-61`.
- Idle TTL sweep: CONFIRMED. `session-client-cache.ts:73-77` + `startSweeping` `:79-85` (`unref()` at `:84`), started at `telegram.service.ts:86`. Effective max idle lifetime = SESSION_CACHE_IDLE_TTL_MS + SESSION_CACHE_SWEEP_INTERVAL_MS = 35 min.
- Every cache eviction releases via `destroy()`: CONFIRMED. All removal goes through `evict` (`session-client-cache.ts:63-70`) -> `releaseQuietly` -> `destroy()` (`:101-107`). Replacement of a key with a different client also evicts (`:52-55`). Every auth-state removal also uses `releaseClient` -> `destroy()` (`telegram.service.ts:103,159,287,294,586-592`).
- `onModuleDestroy` clears intervals and releases cached and pending auth clients: CONFIRMED. `telegram.service.ts:92-97` clears `authStateSweepTimer`, destroys every auth-state client and calls `clients.close()` (clears the cache interval, evicts all). Reached through `closeApplication` -> `app.close()` (`process-handlers.ts:41-55`). Gap: clients in flight (created, not yet stored) are not tracked; they die with the process, so no runtime cost.
- Every external-call timer cleared: CONFIRMED. `with-timeout.ts:12` / `:18` clears in `finally`. Every GramJS call in the service is wrapped: connect `:127,:330`, sendCode `:167`, SignIn `:213`, GetPassword `:251`, CheckPassword `:260`, getInputEntity `:381`, getMessages `:423`, GetUsers `:467`. Note: a timed-out call is not cancelled inside GramJS; it stays in the sender queue until answered or the client is destroyed (bounded by the cache).
- Explicit GramJS options from constants: CONFIRMED. `telegram.service.ts:113-122`: FLOOD_SLEEP_THRESHOLD_S (5), CONNECTION_RETRIES_COUNT (3), REQUEST_RETRIES_COUNT (3), RETRY_DELAY_MS, `autoReconnect: true` explicit. Not set: `baseLogger` (see M-2).
- Bounded post walk POSTS_MAX_MESSAGES: CONFIRMED. `telegram.service.ts:390-404`: at most POSTS_MAX_MESSAGES / POSTS_PAGE_SIZE = 10 pages + 1 probe + 1 entity resolve = 12 calls; `isTruncated` returned (`:365`) and computed by a one-message probe (`:408-416`).
- Log volume per request: service-level CONFIRMED at exactly 1 line per request (success `:182,:233,:243,:273,:361,:472,:479`; failure `failWith` `:488-497`; restore line `:205` is `debug`, suppressed by `main.ts:16`). GramJS adds unmanaged console lines per client (M-2).
- Auth-state Map bounded: REFUTED. TTL only, no size ceiling (H-1).
- Synchronous fs on request paths: PRESENT, pre-existing file-backed store (H-2).

## CRITICAL

None.

## HIGH

### H-1 [PRE] Auth-state Map has a TTL but no size ceiling

- File: `src/telegram/telegram.service.ts:62` (declaration), `:175` (insert), `:204` (insert on restore), `:99-108` (sweep).
- Retained: one connected `TelegramClient` per pending phone number (socket + update loop pinging every 9 s) plus `phoneCodeHash`.
- Should release: a declared maximum (the rule requires a ceiling for every cache of live objects) with oldest-first eviction via `releaseClient`; TTL sweep already exists.
- Growth: the only effective bound is external. PhoneRateLimitGuard admits at most RATE_LIMIT_STORE_MAX_ENTRIES = 1000 distinct phones per RATE_LIMIT_AUTH_WINDOW_MS (1 h); the per-key limit admits 60/min. An entry lives up to AUTH_STATE_TTL_MS + AUTH_STATE_SWEEP_INTERVAL_MS = 15 min. Ceiling per caller key: 60 x 15 = 900 concurrently connected pending clients; hard ceiling across keys: 1000. Keys are also raw strings, so `+7...` and `7...` are separate entries under one guard counter (up to 5 entries per digit-normalised phone).
- Weekly cost (sustained abuse by one valid key): ~900 live sockets x 400 pings/h = 360,000 pings/h, 60.5 M pings/week, plus ~3,600 SMS sends/hour charged to the Telegram application; memory for 900 MTProto senders.
- Change status: the change moved the TTL to constants and switched to `destroy()`, but added no ceiling.

### H-2 [PRE, known deviation] Synchronous whole-file read-modify-write on request paths

- File: `src/telegram/telegram.service.ts:515-572`; call sites on request paths: `:161` and `:181` (auth step 1: up to 2 RMW cycles = 2 reads + 2 writes), `:193` (step 2 miss: sync read), `:232,:272` (success: `saveSession` RMW + `deleteAuthState` RMW), `:289` (error: RMW), `:315` (every session-cache miss: `existsSync` + `readFileSync` + `JSON.parse` of the whole `sessions.json`). Timer path: `:105` RMW per expired entry in the sweep. Boot: `mkdirSync` `:509`.
- Retained: `data/sessions.json` grows by one ~360-byte session string per successful auth. `deleteSession` is only reached from `disconnect()` (`:502`), which no controller or code path calls, so the file never shrinks until a deploy wipes it.
- Growth: +~360 B per auth; every cache miss (including any unknown session string sent by a keyed caller, up to 60/min/key) parses the whole file on the event loop.
- Weekly cost: at 1,000 auths/week the file reaches ~360 KB and each miss blocks the event loop for one full parse; every successful auth performs 4 synchronous file operations.
- Classification: pre-existing, recorded under Known Deviations in `.claude/rules/telegram.md`. Not extended by this change (no new call sites beyond the reordered existing ones).

## MEDIUM

### M-1 [NEW interaction] Revoked session left in `sessions.json` triggers a fresh connect on every request

- File: `src/telegram/telegram.service.ts:336-340` (`evictIfSessionInvalid`, new) combined with `:314-321` (file restore, pre-existing).
- Retained: nothing permanently, but the invalid session string stays in `sessions.json` because eviction does not call `deleteSession`.
- Mechanism: request -> cache miss -> sync file read -> `createClient` -> connect (TCP + MTProto handshake, ~4 GramJS log lines) -> Telegram rejects with AUTH_KEY_UNREGISTERED -> evict -> `destroy()`. Next request repeats the whole cycle. Before this change the dead client stayed cached (no reconnect per request); now each request pays a handshake.
- Growth: one full connect + destroy per request carrying a revoked session, capped only by the per-key limit: up to 60 connects/min/key.
- Weekly cost (one integration polling a revoked session once a minute): 10,080 handshakes and ~60,000-70,000 GramJS log lines per week, per revoked session.

### M-2 [PRE] GramJS default logger writes to console at `info`, outside the NestJS Logger

- File: `src/telegram/telegram.service.ts:115-121` (no `baseLogger`); library `node_modules/telegram/extensions/Logger.js:20`, lines emitted at `telegramBaseClient.js:69`, `network/MTProtoSender.js:236,268,279`, `client/TelegramClient.js:1098`, `client/updates.js:201-203`.
- Retained: log volume (billed).
- Growth: ~4 lines per client creation+connect ("Running gramJS version", "Connecting to", "Connection ... complete!", "Using LAYER"), ~1-2 per `destroy()`, and a full `console.error(err)` per failed ping per client (every 9 s during a network fault).
- Per-request totals: posts/me on cache hit = 1 line; on cache miss (file restore) = ~5; auth step 1 = ~5; revoked-session request (M-1) = ~6-7. During a 10-minute network fault with 50 cached clients: 50 x 67 ping failures = ~3,300 stack traces.
- Also defeats the intent of `src/no-console.spec.ts`: the ban covers `src/` but GramJS writes to console on the service's behalf.

### M-3 [PRE] Concurrent auth requests for the same phone orphan a connected client

- File: `src/telegram/telegram.service.ts:157-181` (step 1) and `:191-205` (step 2 restore).
- Retained: the client whose `authStates.set` is overwritten by a concurrent request for the same phone. It is in no map, so neither the TTL sweep, nor `onModuleDestroy`, nor any error branch releases it; its update loop pings every 9 s for the life of the process.
- Growth: up to RATE_LIMIT_AUTH_MAX_REQUESTS - 1 = 4 orphans per phone per hour when requests overlap (double-submit, client retry after a 30 s timeout). Same pattern for two concurrent step-2 requests that both restore from file.
- Weekly cost per orphan: 67,200 pings + 336 `GetState` calls + one open socket, never reclaimed until restart.
- Change status: the change replaced `disconnect()` with `destroy()` on the known paths but kept the check-then-set without a guard.

### M-4 [NEW] No overall deadline per HTTP request; one posts request can occupy the process for ~6.5 min

- File: `src/telegram/telegram.service.ts:347-429`.
- Retained: the request, its sockets and the memory of up to POSTS_MAX_MESSAGES messages.
- Worst case: reconnect 30 s + entity resolve 30 s + 10 pages x 30 s + probe 30 s = 390 s, each call individually within EXTERNAL_CALL_TIMEOUT_MS. The previous single iteration had no per-call timeout at all, so this is an improvement, but the per-request ceiling is 12-13 x EXTERNAL_CALL_TIMEOUT_MS rather than one.
- Cost: a slow Telegram DC turns each posts request into up to 6.5 min of held process time; 60 such requests/min/key would stack.

### M-5 [PRE] `uncaughtException` handler exits the process

- File: `src/shared/utils/process-handlers.ts:23-26` -> `closeApplication(app, EXIT_CODE_FAILURE)` -> `process.exit` `:54`.
- Listed as an anti-pattern in `.claude/rules/runtime-resources.md` (Process Stability). Each restart empties the 50-entry cache and all pending auth states, forcing up to 50 re-connects and re-authentications. Not touched by this change.

## LOW

### L-1 [NEW] Concurrent cache misses on the same session destroy a client in use

- File: `src/telegram/utils/session-client-cache.ts:52-55` via `telegram.service.ts:314-320`.
- Two concurrent misses for one session both connect a client; the second `set` evicts and destroys the first while its request is running, which then fails. No leak (the old code overwrote without release and leaked), but one wasted handshake and one failed request per race.

### L-2 [NEW] LRU eviction can destroy a client mid-request

- File: `src/telegram/utils/session-client-cache.ts:56-58`.
- `get` touches only at request start; if SESSION_CACHE_MAX_ENTRIES new sessions arrive during a long posts walk (up to ~6.5 min, M-4), the in-use client is evicted and destroyed. No leak; the affected request fails.

### L-3 [NEW] Double release on connect failure in auth step 1

- File: `src/telegram/telegram.service.ts:125-132` releases on connect failure, then the outer catch `:293-295` releases the same client again. `destroy()` is idempotent in effect; cost is one extra GramJS "Not disconnecting" log line per failed connect.

### L-4 [NEW] Reconnect timeout leaves the cached client in place

- File: `src/telegram/telegram.service.ts:327-333`.
- A cached client whose reconnect times out stays cached with a connect still in flight; the next request calls `connect()` again. Bounded by the cache ceiling and idle TTL; no growth beyond SESSION_CACHE_MAX_ENTRIES.

## Maximum Live Clients

- Session cache: SESSION_CACHE_MAX_ENTRIES = 50.
- Pending auth: unbounded by code; externally ~900 per key, 1000 hard (H-1).
- Orphans: unbounded over process lifetime (M-3).
- In flight (connecting, not yet stored): bounded by concurrent requests.

## Three Changes That Remove the Most Cost

1. Put a ceiling on `authStates` (oldest-first eviction through `releaseClient`) and make the step-1/step-2 insert release any client it overwrites (H-1, M-3).
2. Pass an explicit `baseLogger` at `error`/`warn` level (or a NestJS-backed adapter) in `createClient` (M-2).
3. When a session is evicted as invalid, also drop it from the persisted session set, or stop restoring clients from `sessions.json` per request (M-1, H-2 — the latter is the open Known Deviation decision).
