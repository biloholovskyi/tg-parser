# Security Audit — block-08-09-refactor-strictness-storage (Finalize)

Date: 2026-09-24
Scope: uncommitted production changes on `r-1.4.1` — `src/telegram/telegram.service.ts` (rewritten as a facade), new `auth.service.ts`, `channel.service.ts`, `session-store.ts`, `telegram-client.factory.ts`, `utils/message.mapper.ts`, `interfaces/auth-result.interface.ts`, and the diffs in `telegram.module.ts`, `utils/telegram-errors.ts`, `constants.ts`, `interfaces/message.interface.ts`, `src/shared/utils/process-handlers.ts`, `tsconfig.json`. Spec files excluded (changing concurrently).
Checklist: `.claude/rules/refactor-security-audit.md` (security pass), `.claude/rules/api-security.md`, `.claude/rules/telegram.md`, `.claude/rules/runtime-resources.md`.
ADR checked against: `docs/plans/block-08-09-refactor-strictness-storage/adr-session-storage.md`.

No credential values appear in this report.

## Counts

- CRITICAL: 0
- HIGH: 1 (carried)
- MEDIUM: 3 (2 new, 1 carried)
- LOW: 6

## Closed by this change

- CRITICAL carried since block-01: file-backed store of session strings and of phone numbers with phone code hashes under `data/`. No production file under `src/` imports `fs` or touches the filesystem; the only `fs` users are `*.spec.ts` files. `SessionStore.getConnected` (`src/telegram/session-store.ts:52-61`) never rebuilds a client from a caller-supplied string: an unknown session is a uniform 401, so disk restore is gone and an arbitrary session string can no longer make the service open an MTProto connection.
- Classification by message substring (block-03-05 M1): `telegram-errors.ts:38-50` classifies by the exact RPC `errorMessage` code; local-message matching is limited to non-RPC errors with prefix/suffix checks.

## Verified clean

- Disk: no read or write of any credential in production code. `/data/` and `/posts_data/` remain in `.gitignore` (lines 44, 48). No `data/` path is tracked.
- Session string: lives only as the cache key in `SessionClientCache` and in the issuing response (`auth.service.ts:162`). Not in any log line, path, query string or error body.
- Phone code hash: held only in the in-memory `AuthState` (`auth.service.ts:20-24`), never logged or returned.
- Phone number: used only as the in-memory map key and as a GramJS argument. Auth logs are fixed strings (`auth.service.ts:81, 114, 161`); failures log `Auth failed: <status> (<describeError>)` through `failWith` (`telegram-errors.ts:161-170`). `describeError` returns the RPC code for RPC errors; for local GramJS errors on this path (`node_modules/telegram/client/auth.js`, `Password.js`) the messages were checked and none echo the phone number, code or password.
- 2FA password: passed only to `computeCheck` (`auth.service.ts:145`).
- GramJS confinement: every `telegram` import in `src/` is under `src/telegram/`. `telegram.controller.ts` imports no GramJS symbol. `new TelegramClient` appears only in `telegram-client.factory.ts:38`, with explicit options from named constants and GramJS console logging held to `LogLevel.ERROR`.
- Release paths for every client-creating path:
  - connect failure → `release` (`session-store.ts:36-39`)
  - `sendCode` failure → `release` (`auth.service.ts:98-100`)
  - any auth-step failure → `dropAuthState` (`auth.service.ts:62-64`)
  - replaced pending login → `release` (`auth.service.ts:166-172`)
  - pending-login expiry → `release` (`auth.service.ts:182-190`)
  - cached client: LRU ceiling, idle sweep, invalid-session eviction and shutdown all go through `SessionClientCache.evict` → `destroy()`
  - shutdown: `TelegramService.onModuleDestroy` closes pending logins, then the cache (`telegram.service.ts:28-31`). Both sweep timers are `unref()`'d and cleared on close.
  One exception, a concurrency race, is reported as M1.
- Perimeter: no change. `telegram.controller.ts`, `src/main.ts`, `src/shared/guards/*`, `src/shared/utils/http-pipeline.ts`, the DTOs, `package.json` and `package-lock.json` have no diff. `telegram.module.ts` only adds providers; the `APP_GUARD` order (ApiKey → RateLimit → PhoneRateLimit) is unchanged.
- Error disclosure: every service failure goes through `toHttpException` with fixed messages. `cause` is kept but not serialized. `/telegram/me` returns the same `failed` for unknown and revoked sessions.
- Config: `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` read only through `src/config/telegram.config.ts`; a missing config logs `describeError` of the loader error, not the values (`telegram-client.factory.ts:53`).
- `tsconfig.json` now enables `strictNullChecks`, `noImplicitAny` and `strictBindCallApply`, which helps security.

## HIGH

### H1 (carried from block-02/03-05) — pending-login map has a TTL but no ceiling

- File: `src/telegram/auth.service.ts:39` (map), `:78-80` (insert), `:46` and `:182-190` (sweep only)
- Attack: every holder of a valid API key can open one connected `TelegramClient` for each distinct phone number, within the per-key and per-phone rate limits. The global number of live MTProto connections has no limit. Each one lives up to `AUTH_STATE_TTL_MS` + `AUTH_STATE_SWEEP_INTERVAL_MS`, pings Telegram, and spends one SMS sent through the project API application. This is memory, socket and cost amplification, and a path to a flood ban on the API application.
- Remediation: add an `AUTH_STATE_MAX_ENTRIES` constant. At the ceiling, reject new code requests with 429/503. Do not evict the oldest entry, because that would let a caller cancel other users' logins. Add a global cap on `sendCode` per window alongside the per-phone cap.

## MEDIUM

### M1 (new) — phone-keyed pending state is dropped or deleted without checking which request owns it

- Files: `src/telegram/auth.service.ts:63` (`dropAuthState` in the catch, unconditional), `:77` (`requestCode` drops whatever is stored), `:160` (`completeLogin` deletes the key unconditionally)
- Attack or failure: concurrent requests for the same phone interfere with each other.
  - A failing request releases the client that a newer, successful request just stored, which kills that login and forces another SMS.
  - `completeLogin` can delete a newer pending entry without calling `release`. That client stays connected and is no longer in any map or sweep, so it leaks until the process exits: a live connection billed indefinitely.
  - A client released mid-sign-in can be `adopt`ed into the session cache as a destroyed client, and its session string is still returned to the caller.
  - A holder of an API key who knows a victim's phone number can cancel that victim's in-progress login at will. Each attempt costs the attacker one per-phone rate-limit slot.
- Remediation: delete or release only when `authStates.get(phone) === state`, the state this request read. In the catch, drop only the request's own state. Or serialize the steps per phone with a per-key promise chain. Add a regression test with two interleaved requests.

### M2 (new, a consequence of the memory-only ADR) — evicted sessions are destroyed locally but never logged out

- Files: `src/telegram/session-store.ts:75-82` (`release` = `destroy()` only), `src/telegram/utils/session-client-cache.ts:233-240` (every eviction path), `session-store.ts:85-87` (shutdown)
- Attack or failure: idle expiry (`SESSION_CACHE_IDLE_TTL_MS`), LRU eviction, every restart and every deploy make the service forget a session. The `sessionString` handed to the caller is still a valid full-account authorization on Telegram's side. The service can no longer use it or revoke it, but anyone holding the string can: a caller's logs, a client database, a leaked request dump. Authorizations pile up on the account, and each is a standing credential with no owner.
- Remediation: before `destroy()` on idle, LRU and shutdown eviction, call `auth.LogOut` under `withTimeout`. Skip it when the eviction was caused by Telegram rejecting the session. Bound the shutdown fan-out to the shutdown timeout. If this is not done, record it as an accepted risk with the user's decision.

### M3 (carried) — dependency advisories

- `rtk npm audit`: 40 across the full tree (21 high, 15 moderate, 4 low); runtime only (`--omit=dev`): 13 (6 high, 7 moderate), including several `qs` DoS advisories. The runtime fix requires `@nestjs/platform-express` 12, a breaking change. Unchanged by this diff (no `package.json` or lockfile change).
- Remediation: plan the Nest major upgrade. Until then, the body-size limit and the API-key guard in front of every body-parsing route are the only mitigations.

## LOW

- L1 — one successful login evicts another user's session at the ceiling. `session-store.ts:47` → `session-client-cache.ts:226-228` evicts the least recently used session once `SESSION_CACHE_MAX_ENTRIES` is reached, with no per-caller quota. Doing this on purpose requires completing real logins, which limits it. Remediation: a per-API-key session quota.
- L2 (carried) — a wrong SMS code or a wrong 2FA password drops the pending login (`auth.service.ts:62-64`), so the next attempt costs a new SMS. Remediation: keep the state on `PHONE_CODE_INVALID` and `PASSWORD_HASH_INVALID`, with a per-state attempt counter.
- L3 — `signIn` does not check expiry when it reads the pending state (`auth.service.ts:105`). An entry outlives `AUTH_STATE_TTL_MS` by up to one sweep interval. Telegram still rejects an expired code, so impact is limited to the lifetime of the held connection. Remediation: check `createdAt` on read.
- L4 — leftover state files from before the ADR. The code no longer reads or writes `data/`, but any `data/sessions.json` or `data/auth-states.json` written by earlier builds on a developer machine or a persistent volume still holds live session strings and phone numbers. Local presence was not verified: the secret guard blocks inspecting `data/`. Remediation: the operator deletes the directory and ends the related authorizations in Telegram (Settings, Devices). Keep `/data/` in `.gitignore`.
- L5 — `test/no-network.e2e-spec.ts:5` imports `telegram` outside `src/telegram/`. It is test-only, so there is no production impact, but the CLAUDE.md hard rule does not state a test exemption.
- L6 — `.claude/hooks/guard-secrets.js:18` still justifies the `data/` block with the now-closed Known Deviation. There is no security effect; keep the block as defense in depth and update the wording.

## Carried, not re-verified in this scope

Findings from `docs/reviews/security-audit-2026-09-23.md` and `docs/reviews/block-03-05-security-audit.md` on code this change did not touch: stale root-level docs that document the session string in a URL (HIGH), phone counter charged before validation and not normalized (MEDIUM), `getApiKeysConfig()` re-read per request (MEDIUM), per-process counters (MEDIUM), chunked body escaping the content-length ceiling (LOW), `PHONE_NUMBER_BANNED` oracle (LOW).

## Verdict

This change contains no CRITICAL finding. It removes the file-backed credential store, the most serious finding carried since block-01. The ADR's claim is confirmed in production code: nothing is written to or read from disk, no credential reaches a log, GramJS is confined to `src/telegram/`, and the perimeter is unchanged.

The service is acceptable to keep exposed only while `API_KEYS` is issued to trusted callers. It is not safe for untrusted key holders until H1 (no ceiling on pending logins) and M1 (cross-request state interference with a connection leak) are fixed.
