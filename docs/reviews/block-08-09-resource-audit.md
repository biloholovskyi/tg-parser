# Resource Audit — block-08-09 refactor (service split, file store removal)

Date: 2026-09-24
Auditor: `resource-leak-auditor` (read-only)
Plan: `docs/plans/block-08-09-refactor-strictness-storage` (phase-04 Finalize item: "client ownership survived the move")
Scope: uncommitted production code on `r-1.4.1`: `src/telegram/telegram.service.ts`, `session-store.ts`, `auth.service.ts`, `channel.service.ts`, `telegram-client.factory.ts`, `utils/message.mapper.ts`, `utils/telegram-errors.ts`, `telegram.module.ts`, `constants.ts`, `src/shared/utils/process-handlers.ts`. Baseline: `git show HEAD:src/telegram/telegram.service.ts`. Specs excluded.
Previous audit for cross-reference: `docs/reviews/block-03-05-resource-audit.md` (IDs H-1..L-4 below refer to it).

## Library facts verified (node_modules/telegram 2.26.22)

- `client/telegramBaseClient.js:191-199`: `destroy()` sets `_destroyed` then disconnects; `client/updates.js:166-168` stops the 9 s ping loop only on `_destroyed`. Release via `destroy()` is correct.
- `client/updates.js:199-206`: a failed ping calls `console.error(err)` when the logger admits ERROR, then `sender.reconnect()`.
- `network/MTProtoSender.js:140-173`: `connect()` loops `_retries` attempts with `sleep(_delay)` and never checks `userDisconnected` between attempts; each failed attempt logs `_log.error` plus `console.error(err)`.
- `network/MTProtoSender.js:54`: `connectTimeout` (from the client `timeout` option) is stored but not read anywhere in the sender; TCP connect has no library timeout without a proxy (`extensions/PromisedNetSockets.js:105` applies only to proxies).

## Ownership map after the move

- Construction: one site, `telegram-client.factory.ts:38`, called from one place, `session-store.ts:34` (`openLoginClient`). No other `new TelegramClient` or `factory.create` in `src/`.
- Connect failure: `session-store.ts:37-39` releases with `destroy()`. CONFIRMED.
- Send-code failure: `auth.service.ts:98-100` releases. CONFIRMED. The outer `dropAuthState` (`:63`) is a no-op for this client, so the HEAD double release (L-3) is gone.
- Sign-in / 2FA failure: `auth.service.ts:62-64` -> `dropAuthState` `:174-180` releases the pending client. CONFIRMED.
- 2FA pending (no password yet): client kept in `authStates` until TTL. Bounded by AUTH_STATE_TTL_MS + AUTH_STATE_SWEEP_INTERVAL_MS = 15 min.
- Overwrite by a concurrent step 1: `storeAuthState` `:166-172` releases the replaced client. CONFIRMED (HEAD M-3 fixed and preserved).
- Success: `completeLogin` `:159` hands the client to `SessionStore.adopt` -> `SessionClientCache.set`; LRU and idle eviction destroy it. CONFIRMED.
- Invalid session: `ChannelService` `:55` and `TelegramService.checkSession` `:66` -> `SessionStore.evictIfSessionInvalid` -> cache `evict` -> `destroy()`. CONFIRMED.
- Shutdown: `TelegramService.onModuleDestroy` `:28-31` -> `AuthService.close` (clears the sweep interval `:70`, destroys all pending clients) -> `SessionStore.close` -> `SessionClientCache.close` (clears the sweep interval, evicts all). Both intervals `unref()`ed (`auth.service.ts:47`, `session-client-cache.ts:84`). Neither `AuthService` nor `SessionStore` has its own lifecycle hook, so there is exactly one shutdown path and no double close. `release` never throws, so a failure in `auth.close()` cannot skip `sessions.close()`.
- Timers per request: only `withTimeout`, cleared in `finally` (`utils/with-timeout.ts`). Every GramJS call on a request path is wrapped (connect x2, sendCode, SignIn, GetPassword, CheckPassword, getInputEntity, getMessages, GetUsers).

Verdict on the key question: client ownership survived the move. Every creation path has a release on every error branch, the success path hands off to the bounded cache, and shutdown releases both pools and clears both intervals.

## Hot path and options

- Synchronous filesystem: none. `grep` over `src/` (non-spec) finds no `fs` import and no `*Sync(` call. HEAD H-2 (whole-file RMW on every auth step and cache miss) and M-1 (revoked session restored from file and reconnected per request) are RESOLVED by removing the file store. L-1 (concurrent file restore races) is gone with it.
- GramJS options (`telegram-client.factory.ts:38-46`): `floodSleepThreshold` FLOOD_SLEEP_THRESHOLD_S, `connectionRetries` CONNECTION_RETRIES_COUNT, `requestRetries` REQUEST_RETRIES_COUNT, `retryDelay` RETRY_DELAY_MS, `autoReconnect: true`, `baseLogger` at `LogLevel.ERROR`. Identical to HEAD `:127-135`. `timeout` is left at the default 10 but, per the library fact above, it has no effect on connect; not a finding.
- Walk ceiling: `channel.service.ts:85-96` stops at POSTS_MAX_MESSAGES and reports `isTruncated` after a 1-message probe. Same as HEAD.
- Log volume: one outcome line per request on every route (`auth.service.ts:81,114,161`, `channel.service.ts:50`, `telegram.service.ts:60,67`, or one `failWith` line on error). No per-item logging; `message.mapper.ts` is pure. Unchanged from HEAD.

## CRITICAL

None.

## HIGH

### H-1 [PRE, still open] Pending-auth Map has a TTL but no size ceiling

- File: `src/telegram/auth.service.ts:39` (declaration), `:171` (insert), `:182-190` (sweep).
- Retained: one connected `TelegramClient` per pending phone key (socket plus update loop pinging every 9 s) and its `phoneCodeHash`.
- Should release: a declared maximum with oldest-first eviction through `SessionStore.release`, as `.claude/rules/runtime-resources.md` requires for every cache of live objects. The TTL sweep exists.
- Growth: bounded only outside this class. Per key: RATE_LIMIT_DEFAULT_MAX_REQUESTS (60/min) x 15 min lifetime = 900 concurrent pending clients; across keys, PhoneRateLimitGuard admits at most RATE_LIMIT_STORE_MAX_ENTRIES = 1000 distinct phones per hour. Map keys are the raw `phoneNumber` while the guard normalises to digits, so one guard bucket can feed up to RATE_LIMIT_AUTH_MAX_REQUESTS = 5 distinct map entries.
- Weekly cost under sustained abuse by one valid key: ~900 live sockets x 400 pings/h = 360,000 pings/h (60.5 M/week), plus the SMS sends billed to the Telegram application.
- Change status: moved verbatim from HEAD `:63`; the refactor neither added nor removed a bound.

## MEDIUM

### M-A [PRE, survived the move] `completeLogin` and `dropAuthState` delete by key without checking identity

- File: `src/telegram/auth.service.ts:159-160` (`await adopt` then `authStates.delete(phoneNumber)`), `:174-180` (`dropAuthState` releases whatever is stored under the key), `:63` (called from every failure).
- Sequence: request X is in `completeLogin`, suspended in `adopt` -> `SessionClientCache.set` -> LRU `evict` -> `destroy()` (a real network await, reached whenever the cache is at SESSION_CACHE_MAX_ENTRIES). Request Y for the same phone runs step 1: `dropAuthState` destroys X's client, which is now being put into the session cache; Y stores its own new client. X resumes and deletes Y's entry.
- Retained: Y's connected client, in no map. Neither the TTL sweep, nor `AuthService.close`, nor any error branch can reach it; it pings every 9 s for the life of the process. X's caller also receives a `sessionString` whose cached client is already destroyed.
- Should release: delete (and release) only when the stored state is the one this request holds, i.e. compare `authStates.get(phone) === state` before `delete` in `completeLogin` and in `dropAuthState` when called from a request's catch.
- Growth: at most RATE_LIMIT_AUTH_MAX_REQUESTS - 1 = 4 orphans per phone per hour, only while the session cache is full and requests for one phone overlap (double submit, client retry).
- Weekly cost per orphan: 67,200 pings + ~168 hourly `GetState` calls + one socket, until restart.
- Related correctness side effect (no leak): a failing request's catch (`:63`) can destroy a concurrent request's freshly stored pending client for the same phone, so the second caller gets "code not requested".

### M-4 [PRE, still open] No overall deadline per posts request

- File: `src/telegram/channel.service.ts:39-112`.
- Worst case: reconnect 30 s + resolve 30 s + 10 pages x 30 s + probe 30 s = 390 s = 13 x EXTERNAL_CALL_TIMEOUT_MS of held process time and up to POSTS_MAX_MESSAGES messages in memory per request. Unchanged by the split.

### M-5 [PRE, still open] `uncaughtException` exits the process

- File: `src/shared/utils/process-handlers.ts:23-26` -> `closeApplication` -> `process.exit` `:54`. Each restart empties up to SESSION_CACHE_MAX_ENTRIES cached sessions and all pending logins. The diff in this file only reshapes the shutdown timer (`.unref()` chained, `:78-81`); behaviour unchanged.

## LOW

### L-A [PRE] Connect attempts continue after the timeout released the client

- File: `src/telegram/session-store.ts:36-38` (login) and `:57-58` (reconnect of a cached client).
- `withTimeout` rejects at EXTERNAL_CALL_TIMEOUT_MS and `destroy()` runs, but `MTProtoSender.connect` keeps looping up to CONNECTION_RETRIES_COUNT attempts without checking `userDisconnected`, and TCP connect has no library timeout. On a blackholed DC that is up to 2 further attempts, each bounded only by the OS SYN timeout (~127 s on Linux defaults), plus 2 `console.error` stack traces per failed attempt. If a late attempt succeeds, a socket opens on a destroyed client: no ping loop (loop exits on `_destroyed`), but the socket stays until Telegram closes it. No growth beyond one per timed-out login.

### L-B [PRE] GramJS still writes stack traces to the console at ERROR level

- File: `src/telegram/telegram-client.factory.ts:45`. HEAD M-2 is fixed (info-level chatter gone), but `updates.js:204` prints `console.error(err)` per failed ping per client. During a 10-minute network fault with 50 cached clients: 50 x 67 = ~3,300 stack traces outside the NestJS logger.

### L-C [NEW, design] `AuthService` holds the factory

- File: `src/telegram/auth.service.ts:43`. It uses only `credentials`/`hasCredentials`, but can call `create()` and bypass `SessionStore`, the documented sole owner. Exposing credentials without `create` would keep a single construction path by type, not by convention.

### L-D [PRE] Requests landing during shutdown

- Nest runs `onModuleDestroy` before closing the HTTP server, so a request can store a pending or cached client after `close()` cleared the maps and intervals. `closeApplication` always ends in `process.exit`, so the client dies with the process; no runtime cost.

### L-2, L-4 [PRE, still open]

- L-2: LRU eviction can destroy a client in use by a long posts walk (`session-client-cache.ts:56-58`). No leak.
- L-4: a cached client whose reconnect times out stays cached (`session-store.ts:57-58`). Bounded by the cache ceiling and idle TTL.

## Status of previous findings

- Resolved by this change: H-2, M-1, L-1, L-3.
- Resolved earlier and preserved: M-2 (now residual L-B), M-3 step-1 overwrite.
- Still open: H-1, M-4, M-5, L-2, L-4; M-3 survives as M-A.

## Maximum live clients

- Session cache: SESSION_CACHE_MAX_ENTRIES = 50.
- Pending auth: unbounded by code; ~900 per key, 1000 hard (H-1).
- Orphans: 0 on every single-request path; up to 4 per phone per hour under the M-A race while the cache is full.
- In flight (connecting, not stored): bounded by concurrent requests.

## Three changes that remove the most cost

1. Put a ceiling on `authStates` with oldest-first release, and normalise the key to digits like the guard (H-1).
2. Make `completeLogin` and `dropAuthState` identity-checked: delete and release only the state this request holds (M-A).
3. Give each posts request one overall deadline instead of 13 independent call timeouts (M-4).
