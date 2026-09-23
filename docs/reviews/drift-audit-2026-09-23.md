# Docs and Rules Drift Audit — 2026-09-23

Scope: `CLAUDE.md`, `.claude/rules/*.md`, `README.md`, root-level docs, `docs/testing/*`,
`railway.toml`, `package.json`, after the working-tree changes of
`docs/plans/block-02-api-perimeter/` (caller authentication by API key, rate limits, session
credential moved from the query string into `x-session-string`).

Process: `.claude/rules/drift-audit.md`. Every claim was checked against the code as it stands in
the working tree (block 02 is staged but not committed), never against another document.

Nothing was edited: production code is read-only for this audit and the invoking session asked for
a report, not fixes. No credential value is reproduced anywhere in this report.

One claim was verified by running it (oversized-body response shape); the probe script was created
outside the repository and removed afterwards.

## Verdict

Block 02 itself is documented correctly: `.claude/rules/api-security.md` now describes the code,
and every constant it names exists with the stated value. The drift is concentrated in three
places that block 02 did not touch: `README.md` (still documents the pre-block-02 contract),
`.claude/rules/architecture.md` (directory inventory), and two claims in `CLAUDE.md` /
`architecture.md` that describe the session cache as bounded when it is not.

- Verified accurate: 14 claim groups (below)
- Doc wrong, code right: 11 findings (D1-D11)
- Code wrong, rule right: 3 findings (C1-C3), all already scheduled in
  `docs/plans/block-03-05-telegram-service/`
- Open decision, escalated: 2 findings (O1, O2)
- Versioning gate: reported, one item outstanding (V1)

## Verified accurate (no action)

1. AUTH_HEADER (`.claude/rules/api-security.md:22`) = `x-api-key` matches
   `src/shared/constants/http.constants.ts:7`, read at `src/shared/utils/api-key-header.ts:6`.
2. SESSION_HEADER (`.claude/rules/api-security.md:23`) = `x-session-string` matches
   `src/shared/constants/http.constants.ts:10`, read at `src/shared/utils/session-header.ts:9`
   and injected at `src/shared/decorators/session-string.decorator.ts:7-8`,
   `src/telegram/telegram.controller.ts:64,83`.
3. RATE_LIMIT_AUTH (`.claude/rules/api-security.md:24`) = 5 per phone per hour matches
   `src/shared/constants/rate-limit.constants.ts:12-13` (`5`, `60 * 60 * 1000`), applied in
   `src/shared/guards/phone-rate-limit.guard.ts:19-23` keyed by the body `phoneNumber`
   (lines 43, 53-61), not by the caller key — as the rule requires.
4. RATE_LIMIT_DEFAULT (`.claude/rules/api-security.md:25`) = 60 per caller per minute matches
   `src/shared/constants/rate-limit.constants.ts:7-8`, applied in
   `src/shared/guards/rate-limit.guard.ts:20-24,39-40` keyed by the API key.
   Window arithmetic in `src/shared/utils/rate-limit-store.ts:44-56` makes request 6 (auth) and
   request 61 (default) the first rejection, which is what the manual test artifact states.
5. REQUEST_BODY_MAX_BYTES (`.claude/rules/api-security.md:27`) = 16 * 1024 matches
   `src/shared/constants/http.constants.ts:1-4`.
6. "No endpoint other than the health probe is reachable without AUTH_HEADER... 401 with no detail"
   (`.claude/rules/api-security.md:31`): `src/shared/guards/api-key.guard.ts:10,34-36` throws one
   opaque `UNAUTHORIZED_MESSAGE`; the health probe opts out through `@PublicRoute()`
   (`src/telegram/telegram.controller.ts:31`, `src/shared/guards/api-key.guard.ts:21-28`), not a
   path comparison. `GET /telegram/health` is the only route carrying the decorator.
7. Guard ordering claim (auth before counters) holds: `src/telegram/telegram.module.ts:13-16`
   registers `ApiKeyGuard` before `RateLimitGuard` and `PhoneRateLimitGuard` as `APP_GUARD`.
8. CORS_MODE (`.claude/rules/api-security.md:26`): `src/config/cors.config.ts:81-86` drops `*`;
   allowed headers include both perimeter headers (`src/config/cors.config.ts:44`).
9. "API keys and origin allowlists are read through a loader in `src/config/`"
   (`.claude/rules/api-security.md:43`): `src/config/api-keys.config.ts:18-26`,
   `src/config/cors.config.ts:60-73`. No `process.env.API_KEYS` read anywhere else.
10. `CLAUDE.md:29` (hard rule: every endpoint except the health probe requires caller
    authentication and a rate limit, no credential in a URL) is now true of the code.
11. `CLAUDE.md:152` (`API_KEYS` row, empty or unset closes everything but health) matches
    `src/config/api-keys.config.ts:19-25` plus `src/shared/guards/api-key.guard.ts:34`: an empty
    key list makes every comparison fail, so the service closes rather than opens.
12. SESSION_TRANSPORT (`.claude/rules/telegram.md:20`, "request header, never a query string") is
    now satisfied. No route reads a session from the URL; on the posts route an unexpected
    `sessionString` query parameter is rejected by the global `ValidationPipe`
    (`src/shared/utils/http-pipeline.ts:40-46` with `GetPostsQueryDto`,
    `src/telegram/dto/messages.dto.ts:94-101`), proven by `test/posts.e2e-spec.ts:129-137`.
13. Known Deviations (`.claude/rules/telegram.md:30-35`) are still accurate, word for word:
    `src/telegram/telegram.service.ts:25-27` declares `data/sessions.json` and
    `data/auth-states.json`; `:525-530` writes session strings; `:500,510` writes phone-number-keyed
    auth state; `:300-310` restores a client from the file. `/data/` is git-ignored
    (`.gitignore:44`), as the deviation states. Block 02 did not extend the store.
14. Deployment, commands and inventories: `railway.toml:2,5,11,12` (RAILPACK, `npm run start:prod`,
    port 8080, `/telegram/health`) matches `CLAUDE.md:140` and `src/main.ts:28-29` with
    `DEFAULT_PORT` (`src/shared/constants/http.constants.ts:13`); every script named in
    `CLAUDE.md` Quick Commands and `.claude/rules/tooling.md` Command Reference exists in
    `package.json:8-22`; the 15 agents and 15 skills listed in `CLAUDE.md` and
    `.claude/rules/index.md` match `.claude/agents/` and `.claude/skills/` exactly; every file in
    `.claude/rules/` is listed in `.claude/rules/index.md`; `.claude/rules/typescript.md:17`
    matches `tsconfig.json`; the guard claim in `CLAUDE.md:158` matches
    `.claude/settings.json:51-62` and `.claude/hooks/guard-secrets.js`.
    `docs/testing/telegram-postman-collection.json` parses, declares schema v2.1.0 (line 5), carries
    no hardcoded credential, and sends both perimeter headers.

## Doc wrong, code right

### D1 — `architecture.md` directory inventory predates block 02

- Claim: `.claude/rules/architecture.md:33` — "`src/shared/` — cross-cutting helpers: `constants/`
  (`http.constants.ts`), `utils/` (`http-pipeline.ts`, `process-handlers.ts`)"; line 32 lists
  `src/config/` as "(`telegram.config.ts`, `cors.config.ts`)".
- Code: `src/shared/` now also contains `guards/` (`api-key.guard.ts`, `rate-limit.guard.ts`,
  `phone-rate-limit.guard.ts`), `decorators/` (`public-route.decorator.ts`,
  `phone-rate-limited.decorator.ts`, `session-string.decorator.ts`) and `exceptions/`
  (`too-many-requests.exception.ts`); `constants/` also holds `rate-limit.constants.ts`;
  `utils/` also holds `api-key-header.ts`, `session-header.ts`, `rate-limit-store.ts`,
  `rate-limit-response.ts`. `src/config/` also holds `api-keys.config.ts`.
- Effect: a rule loaded for any module work names a layout that no longer exists, so new code has
  no documented home for a guard or a decorator, and `src/shared/` line 37 still names a `types/`
  folder that has never existed.
- Action: extend lines 32-33 with `guards/`, `decorators/`, `exceptions/`, the new constants and
  utils files, and `api-keys.config.ts`. Add a bullet to the Module Checklist (lines 84-95) stating
  where a perimeter guard lives.

### D2 — `CLAUDE.md` REST surface does not name the session transport

- Claim: `CLAUDE.md:45` — "time-filtered posts, authorized by a `sessionString`"; `CLAUDE.md:44`
  for `/telegram/me` says nothing about transport.
- Code: `src/telegram/telegram.controller.ts:64,83` take the credential from the
  `x-session-string` header only; `:20` holds the rejection message naming that header.
- Classification: incomplete rather than false, but this is the file loaded into every session, and
  the single most consequential change of block 02 is invisible in it.
- Action: state the header on lines 44-45 and add a line naming `x-api-key` as the caller key for
  every route but health.

### D3 — `CLAUDE.md` key source files omit the whole perimeter

- Claim: `CLAUDE.md:51-57` lists the key source files.
- Code: `src/config/api-keys.config.ts`, `src/shared/guards/*`, `src/shared/decorators/*`,
  `src/shared/constants/rate-limit.constants.ts` are all absent from that list although they now
  gate every request.
- Action: add `src/config/api-keys.config.ts`, `src/shared/guards/api-key.guard.ts` and the two
  rate-limit guards.

### D4 — `README.md` documents the session credential as a query parameter

- Claim: `README.md:125` — "`sessionString` (query) - строка сессии из `/auth`"; example at
  `README.md:130` puts a full account credential in a URL.
- Code: `src/telegram/telegram.controller.ts:83-87` reads the header and returns 400 when it is
  absent; `test/posts.e2e-spec.ts:129-137` proves the query form is rejected.
- Rule contradicted: `.claude/rules/api-security.md:23,33` and the anti-pattern at line 61.
- Severity: highest of the documentation findings. The README teaches the exact practice the
  project classifies as a credential leak, and a reader following it gets a 400 anyway.
- Action: rewrite the section to use `-H "x-session-string: ..."` and `-H "x-api-key: ..."`.

### D5 — `README.md` lists implemented perimeter features as future work

- Claim: `README.md:235-236` — "Rate limiting", "Аутентификация через API ключи" under
  "В будущем можно добавить".
- Code: `src/telegram/telegram.module.ts:14-16` registers all three guards globally.
- Action: delete both bullets; document the perimeter instead.

### D6 — every `README.md` curl example now returns 401

- Claim: `README.md:63,81,100,130` — four working examples, none of which sends `x-api-key`.
- Code: `src/shared/guards/api-key.guard.ts:34-36` rejects them; only
  `GET /telegram/health` is public (`src/telegram/telegram.controller.ts:31`).
- Action: add the header to every example and document `API_KEYS` in the `.env` sample
  (`README.md:22-27`), which also omits it.

### D7 — `README.md` Railway variable list is incomplete

- Claim: `README.md:187-190` names only `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `PORT`.
- Code: `src/config/api-keys.config.ts:5` (`API_KEYS`) and `src/config/cors.config.ts:42`
  (`CORS_ALLOWED_ORIGINS`) are both read at runtime; without `API_KEYS` a deployed service answers
  401 on every route but health.
- Action: add both rows, matching `CLAUDE.md:151-152`.

### D8 — `README.md` source tree is stale

- Claim: `README.md:196-211` shows `src/` with only `telegram/` and
  `config/telegram.config.ts`.
- Code: `src/shared/` (constants, decorators, exceptions, guards, utils) and
  `src/config/cors.config.ts`, `src/config/api-keys.config.ts` are missing from the tree.
- Action: regenerate the tree or drop it and link `CLAUDE.md`.

### D9 — `README.md` documents neither `/telegram/health` nor `/telegram/me`

- Claim: `README.md:54` "API Endpoints" documents two of the four routes.
- Code: `src/telegram/telegram.controller.ts:32` and `:61` expose the other two;
  `/telegram/health` is also the platform probe (`railway.toml:12`).
- Action: add both, including the deliberate always-200 contract of `/telegram/me` (see O2).

### D10 — port and boot-log claims in root docs

- Claim: `README.md:45` — "Сервер запустится на `http://localhost:3000`", which contradicts
  `README.md:29` in the same file; `FIX_ENV_ERROR.md:39` sets `PORT=3000` and `FIX_ENV_ERROR.md:112`
  quotes a boot line "🚀 Telegram Parser Service running on port 3000".
- Code: `src/main.ts:28` falls back to `DEFAULT_PORT` = 8080
  (`src/shared/constants/http.constants.ts:13`), and `src/main.ts:31` logs
  "Telegram parser service listening on port ${port}" — no emoji, different wording.
- Action: align both root docs on 8080 as the default and quote the real log line, or delete
  `FIX_ENV_ERROR.md`, which is a troubleshooting note for a bug its own line 11 says is fixed.

### D11 — two inaccurate expectations in the manual test artifact

- Claim A: `docs/testing/telegram-manual-testing.md:44` (case V5) expects
  `{"statusCode":413,"message":"request entity too large"}`.
  Actual, verified by running the real pipeline against an oversized body:
  `{"message":"Payload Too Large","statusCode":413}`. The rejection comes from
  `enforceContentLengthLimit` (`src/shared/utils/http-pipeline.ts:25-38`) raising
  `PayloadTooLargeException` before any body parser sees the request, so the body-parser wording in
  the document can never appear. No automated test pins the body — `src/shared/utils/http-pipeline.spec.ts:156`
  and `test/auth.e2e-spec.ts:207,221` assert the status only — which is why this survived.
- Claim B: `docs/testing/telegram-manual-testing.md:18` — "В query-параметре строка сессии не
  принимается — такой запрос отклоняется с 400", stated for `/telegram/me` and the posts route
  together. True for the posts route only. `/telegram/me` declares no `@Query()` parameter
  (`src/telegram/telegram.controller.ts:61-71`), so an unknown query parameter is ignored and the
  route answers 200 `{"status":"failed"}` — pinned by `test/app.e2e-spec.ts:182-190`. Case P4
  (line 59) is correctly scoped to the posts route; only the summary line overreaches.
- Action: correct the V5 body and narrow line 18 to the posts route, adding a `/telegram/me` case
  that states 200 `failed`.

Everything else in `docs/testing/telegram-manual-testing.md` was checked case by case against the
code and holds, including H1-H4, V1-V9, P1-P7, C1-C5 and A5.

## Code wrong, rule right (rule stands — do not relax)

### C1 — the session cache is unbounded and never swept

- Rule: `.claude/rules/runtime-resources.md:14-16` (SESSION_CACHE_MAX_ENTRIES = 50,
  SESSION_CACHE_IDLE_TTL_MS = 30 * 60 * 1000, SESSION_CACHE_SWEEP_INTERVAL_MS = 5 * 60 * 1000) and
  lines 26-27 ("A `Map` that only grows is a defect, not a cache"; eviction disconnects).
- Code: `src/telegram/telegram.service.ts:22` — `private clients: Map<string, TelegramClient> = new Map();`
  with no ceiling and no idle sweep. The only interval in the service
  (`src/telegram/telegram.service.ts:46-61`) expires `authStates`, not `clients`. A grep across
  `src/` finds no `SESSION_CACHE_*` identifier at all.
- Doc consequence (this is the drift): `CLAUDE.md:47` — "The cache is bounded and idle clients are
  evicted and disconnected" — and `.claude/rules/architecture.md:54` — "The cache is bounded, idle
  entries are evicted, and eviction disconnects the client" — both state this as a fact about the
  running system. It is not one.
- Classification: the rule stands; the code is the defect. Already scheduled as
  `docs/plans/block-03-05-telegram-service/phase-01-client-lifecycle.md`, which names
  SESSION_CACHE_MAX_ENTRIES.
- Action: fix the code in block 03-05. Meanwhile mark `CLAUDE.md:47` and
  `.claude/rules/architecture.md:54` as the target model with the deviation named — the same
  treatment `CLAUDE.md:5` already gives to file-backed persistence. Do not soften
  `runtime-resources.md`.

### C2 — GramJS client options are left at library defaults

- Rule: `.claude/rules/runtime-resources.md:37-38` — `floodSleepThreshold` must be set to
  FLOOD_SLEEP_THRESHOLD_S (5) because the GramJS default of 60 sleeps inside the request;
  `requestRetries` must be bounded.
- Code: `src/telegram/telegram.service.ts:69-71` passes `{ connectionRetries: 5 }` only. Neither
  `floodSleepThreshold` nor `requestRetries` appears anywhere in `src/`.
- Consequence: the 429 contract in `.claude/rules/telegram.md:55` cannot hold for waits under a
  minute — GramJS sleeps instead, and the caller pays for the occupied process time.
- Action: block 03-05; rule stands.

### C3 — synchronous filesystem access on the request path

- Rule: `.claude/rules/runtime-resources.md:44-45`; also a hard rule in `CLAUDE.md:30`.
- Code: `src/telegram/telegram.service.ts:300-303` calls `loadSessions()` inside `getClient()`,
  which is on every `/telegram/me` and posts request; `:518-519` uses `fs.existsSync` and
  `fs.readFileSync`; `:525-530` and `:535-540` read-modify-write the whole file.
  `:30` also calls `ensureDataDir()` (`fs.mkdirSync`, line 480) in the constructor.
- Classification: part of the open file-store decision (`.claude/rules/telegram.md:34`), so the fix
  is blocked on that fork, but the rule is not in doubt.

## Open decisions (escalate — do not resolve by editing either side)

### O1 — the file-backed session store, restated after block 02

The deviation text in `.claude/rules/telegram.md:34` is still exactly accurate, and block 02 did
not extend the store, as the rule demands. Two doc lines nevertheless assert the opposite of the
code and should not be left standing while the fork is open:

- `CLAUDE.md:47` — "Everything is lost on process restart". Contradicted by
  `src/telegram/telegram.service.ts:300-310`, which restores a client from `data/sessions.json`
  after a restart. `CLAUDE.md:5` describes the deviation correctly; line 47 then contradicts line 5
  in the same always-loaded file.
- `README.md:222-223` — "Сессия хранится в памяти сервера / После перезапуска сервера нужно
  авторизоваться заново", same contradiction, plus `README.md:224` recommending a database for
  production, which contradicts `.claude/rules/architecture.md:10` and
  `.claude/rules/telegram.md:28`.

Fork for the user: drop the files (restoring the documented model) or move to an encrypted external
store. Until then the honest wording is "lost on process restart, except for the file-backed store
recorded as a known deviation". The rule text itself needs no change.

### O2 — `GET /telegram/me` answers 200 where the error table says 400

- Rule: `.claude/rules/telegram.md:51` — "Missing or malformed `sessionString` → 400
  `BadRequestException`", stated without exception.
- Code: `src/telegram/telegram.controller.ts:61-71` deliberately always answers 200 with
  `{"status":"success"|"failed"}`; the comment at `:58` states the intent, `test/app.e2e-spec.ts:172-180`
  pins it, and `docs/testing/telegram-manual-testing.md:82` (A5) documents it. The posts route does
  follow the table (`src/telegram/telegram.controller.ts:85-87`).
- This predates block 02 (`git diff HEAD -- src/telegram/telegram.controller.ts` shows the
  always-200 contract unchanged), so it is long-standing, not new drift.
- Fork for the user: either `/telegram/me` is a session probe whose contract is a 200 with a status
  field — in which case the error table needs an explicit, user-approved exception for it — or the
  table is right and the route should return 400 on a missing header, which is a breaking contract
  change for any existing caller. Not resolved here, and the rule was not edited.

## Version and changelog (owned by `.claude/rules/versioning-changelog.md`, reported here)

### V1

- Branch gate: branch `r-1.4.0` = `r-` + 1.4.0. Pass.
- Version-file gate: `package.json:3` is `1.4.0`. Pass.
- Changelog gate: partial. `CHANGELOG.md:1` carries `[1.4.0] 22.09.2026` at the top of the file,
  and its four bullets (lines 3-6) all describe block 01 — health probe, process handlers, CORS,
  validation and the body limit. Block 02 — API-key authentication, rate limits, and the move of the
  session credential into `x-session-string` — has no bullet, and the header date is one day stale
  against today (2026-09-23). Per `.claude/rules/versioning-changelog.md:43-45` both are prep edits
  for whoever commits block 02: refresh the date and prepend one `- [TGS] - ` bullet per completed
  task at the top of the 1.4.0 list. Nothing was committed or edited by this audit.

## Not drifted

Checked and found consistent, listed so the next audit does not re-derive them: the task-to-rule
table in `CLAUDE.md`, the rule inventory in `.claude/rules/index.md`, the agent and skill
inventories, `.claude/rules/tooling.md` command reference, `.claude/rules/typescript.md` against
`tsconfig.json`, `.claude/rules/api-contracts.md` artifact requirements against the two files in
`docs/testing/` (naming, v2.1.0 schema, auth folder storing `sessionString` in a collection
variable, negative cases, no committed credential), and every deployment fact in `railway.toml`.
