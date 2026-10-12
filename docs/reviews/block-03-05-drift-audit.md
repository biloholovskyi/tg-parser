# Drift Audit — block-03-05-telegram-service — 2026-09-23

Scope: uncommitted changes of `docs/plans/block-03-05-telegram-service/` checked against `CLAUDE.md`,
`.claude/rules/*.md` and `README.md`. Process: `.claude/rules/drift-audit.md`.
Classes: A = doc wrong, code right; B = code wrong, rule right; C = open decision.

## Drift found

1. Session cache described as a bare `Map<sessionString, TelegramClient>`.
   Doc: `CLAUDE.md` Session model paragraph, `.claude/rules/architecture.md:52`, `.claude/rules/telegram.md:15` (SESSION_CACHE).
   Code: `src/telegram/telegram.service.ts:57-61` uses `SessionClientCache` (`src/telegram/utils/session-client-cache.ts:23`), LRU at the ceiling (`:56-58`), idle sweep (`:73-85`), eviction calls `destroy()` (`:101-107`).
   Class A. Fixed in all three places.

2. `GET /telegram/me` described as returning "account info".
   Doc: `CLAUDE.md:44`, `.claude/rules/architecture.md:45`.
   Code: `src/telegram/telegram.service.ts:464-482` returns only `{ status }`; transport errors and flood waits are thrown (503/429), `failed` only for invalid sessions.
   Class A. Fixed in both.

3. Error mapping table missing the new rows and wrong on "malformed session -> 400".
   Doc: `.claude/rules/telegram.md:51` (old table).
   Code: `src/telegram/utils/telegram-errors.ts:78-101` (503 connectivity, 502 fallback, auth-input 400 incl. phone number), `src/telegram/telegram.service.ts:323` (unknown session -> 401), `src/telegram/telegram.controller.ts:67-69,86-88` (missing header: 200 failed on `/me`, 400 on posts).
   Class A. Fixed: rows for 401 unknown session, 503, 502, plus a note on `/me` behaviour.

4. Posts response shape (`isTruncated`) and walk ceiling not described.
   Doc: `CLAUDE.md:45`, `.claude/rules/architecture.md:46` (omission, not contradiction).
   Code: `src/telegram/interfaces/message.interface.ts:14-19`, `src/telegram/telegram.service.ts:376-405`.
   Class A. Fixed.

5. Runtime constants block incomplete.
   Doc: `.claude/rules/runtime-resources.md` Constants. The six listed values match `src/telegram/constants.ts` exactly; PING_INTERVAL_S = 9 and the GramJS default flood threshold 60 were verified in `node_modules/telegram`.
   Missing: AUTH_STATE_SWEEP_INTERVAL_MS, CONNECTION_RETRIES_COUNT, REQUEST_RETRIES_COUNT, RETRY_DELAY_MS, POSTS_PAGE_SIZE, POSTS_MAX_MESSAGES.
   Class A. Fixed: added with their code values and location.

6. Key source files list missing the new files.
   Doc: `CLAUDE.md` Key source files; `.claude/rules/architecture.md:31`.
   Code: `src/telegram/constants.ts`, `src/telegram/utils/{session-client-cache,telegram-errors,with-timeout}.ts`; `GetPostsResponse` in `message.interface.ts`.
   Class A. Fixed.

7. ESLint `no-console` override not recorded.
   Doc: `.claude/rules/typescript.md` Compiler Config (only mentioned `no-explicit-any`).
   Code: `.eslintrc.js` overrides (`src/**/*.ts`, spec files excluded), `src/no-console.spec.ts`.
   Class A. Fixed (one line). Rules forbidding `console.*` already matched.

8. README out of date (not edited: outside the allowed scope).
   `README.md:143` says `/me` always answers 200 — code now throws 503/429 (`telegram.service.ts:475-477`).
   `README.md:164-184` posts example lacks `isTruncated` and `postUrl`.
   `README.md:224-243` tree lacks `constants.ts` and `utils/`; `README.md:258` "session is stored in server memory" omits the file store.
   Class A. Not fixed; proposed README edit.

9. CHANGELOG does not mention this plan.
   `CHANGELOG.md` `[1.4.1] 23.09.2026` has no bullet for the cache, error mapping or `isTruncated`. `package.json` 1.4.1 and branch `r-1.4.1` agree.
   Owned by `.claude/rules/versioning-changelog.md` (Finalize item). Not fixed.

## Code defects (class B, rules stand, not edited)

10. Synchronous file I/O on request paths.
    Rule: `.claude/rules/runtime-resources.md` Hot Path Discipline.
    Code: `src/telegram/telegram.service.ts:181,193,231,315` call `saveAuthState` / `loadAuthStates` / `saveSession` / `loadSessions` (`:515-572`, `readFileSync`/`writeFileSync`/`existsSync`). Part of the file-backed store; resolved by the Known Deviation decision.

11. Different messages for "session unknown" and "session revoked".
    Rule: `.claude/rules/api-security.md` Hard Rules — errors never disclose whether a session exists.
    Code: `src/telegram/telegram.service.ts:44,323` vs `src/telegram/utils/telegram-errors.ts:19,88`. Both 401, but the text differs. Low severity.

12. Missing-config check only on the auth route.
    Rule: `.claude/rules/telegram.md` table — missing credentials -> 500 configuration message at use time.
    Code: `missingConfigException` only in `authenticate` (`telegram.service.ts:148-150`); the file-restore path in `getClient` (`:315-320`) builds a client with `apiId 0` and would surface as 502/503. Reachable only through the file store. Low.

## Open decision (class C)

13. File-backed session store — unchanged. `.claude/rules/telegram.md` Known Deviations still matches the code (`telegram.service.ts:65-67,515-572`); no new code extends it (restore paths already exist at `HEAD`). Kept as is.

## Verified accurate

- Agent (15) and skill (15) inventories in `CLAUDE.md` and `.claude/rules/index.md` match `.claude/agents/` and `.claude/skills/`.
- Railway: port 8080 (`railway.toml`, `DEFAULT_PORT` in `src/shared/constants/http.constants.ts:13`), health path, start command.
- GramJS imports only inside `src/telegram/`.
- Explicit client options (`telegram.service.ts:115-121`), eviction on invalid session (`:336-340`), shutdown releases every client and clears timers (`:92-97`), all external calls wrapped in `withTimeout`.
