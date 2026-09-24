# Drift Audit — 2026-09-24

Scope: Finalize drift check for `docs/plans/block-07-repo-hygiene` (version 1.4.1). Checked `README.md`, `DEPLOYMENT.md`, `CLAUDE.md`, `docs/integrations/n8n-workflow-guide.md`, `docs/integrations/n8n-telegram-bot.md` (links only), `examples/test-api.http`, `examples/client.js` against `src/`, `railway.toml`, `package.json`. Process: `.claude/rules/drift-audit.md`.

## Findings

1. README states the step-1 auth response message as "Phone code is required. Please provide the code sent to your phone."
   - Claim: `README.md:76`
   - Actual: `src/telegram/telegram.service.ts:200` returns "Phone code has been sent to your phone. Please provide the code."
   - Classification: doc wrong, code right
   - Action: replace the message in the README example with the one the code returns.

2. The n8n guide says sessions live only in process memory and are lost on every restart and deploy.
   - Claim: `docs/integrations/n8n-workflow-guide.md:308`
   - Actual: `src/telegram/telegram.service.ts:247` and `:287` write the session string to `data/sessions.json`; `:331-336` restore a client from that file when it is missing from the cache. A plain restart can therefore keep a session; a deploy wipes it. This hides the known deviation (`.claude/rules/telegram.md` Known Deviations) instead of describing it.
   - Classification: doc wrong, code right (as a description of current behaviour; the deviation itself remains an open decision)
   - Action: reword it to match the honest wording in `DEPLOYMENT.md:62`: the cache lives in memory, the code also writes to `data/`, the session is lost after a deploy and may survive a plain restart, and callers must not rely on that.

3. The README error-code list for the posts route includes `500` when `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` are not set, and "wrong code or 2FA password" under `400`.
   - Claim: `README.md:190-197`, placed under `GET /telegram/channel/:channelUsername/posts`
   - Actual: the missing-config 500 is thrown only by `authenticate` (`src/telegram/telegram.service.ts:162-164`). The posts path has no config check: with an empty cache it returns 401 (`src/telegram/telegram.service.ts:338`). Wrong-code and wrong-password 400s come only from `POST /telegram/auth` (`src/telegram/utils/telegram-errors.ts:132-135`).
   - Classification: doc wrong, code right (minor: the list mixes auth-route and posts-route statuses)
   - Action: label the list as covering all routes, or move the 500 and the code/password 400s under `POST /telegram/auth`.

4. The README says `channelUsername` is accepted with or without `@`.
   - Claim: `README.md:150`
   - Actual: validation accepts a leading `@` (`src/telegram/dto/messages.dto.ts:557`), but `parseMessage` builds `postUrl` from the raw input (`src/telegram/telegram.service.ts:466`). The result is `https://t.me/@name/<id>`, which is not a valid post link. The unit test `src/telegram/telegram.service.spec.ts:762` repeats the raw-input construction, so it does not catch this.
   - Classification: code wrong, doc right (the documented input is accepted, but the output for it is malformed)
   - Action: report as a code defect. Strip a leading `@` before building `postUrl`, and add a regression test. Do not change the README.

5. Two statements about whether the filesystem survives a plain restart disagree.
   - Claim A: `DEPLOYMENT.md:62` says a session may be restored from `data/` after a plain container restart.
   - Claim B: `.claude/rules/runtime-resources.md:29` says RUNTIME_FILESYSTEM is ephemeral, reset on every deploy and restart.
   - Actual: the code does try to restore from the file (finding 2). Whether Railway keeps the container filesystem across an `ON_FAILURE` restart (`railway.toml` `restartPolicyType`) is platform behaviour that cannot be checked from the code.
   - Classification: open decision / unverifiable fact
   - Action: escalate. Confirm the Railway behaviour, then align one side. Edit neither side until then.

6. Internal markdown links in `docs/integrations/` are relative (`./n8n-telegram-bot.md`, `../../DEPLOYMENT.md`).
   - Claim: `.claude/rules/commit-message-and-crosslinks.md` sets CROSSLINK_INTERNAL_STYLE = repo-root path, with no `./` or `../` for doc links.
   - Actual: `docs/integrations/n8n-workflow-guide.md:24-25` and `docs/integrations/n8n-telegram-bot.md:65` use relative links. They all resolve.
   - Classification: open decision (the literal rule would make these links break when rendered on GitHub, because a repo-root path from a nested file does not resolve; the rule reads as aimed at AI-facing rule links)
   - Action: escalate. Either scope the rule to rule and AI-facing files, or accept that user-facing docs use relative links. Do not edit either side now.

7. The n8n guide advises "increase" the HTTP node timeout to 30000 ms.
   - Claim: `docs/integrations/n8n-workflow-guide.md:312`
   - Actual: each Telegram call is capped separately at EXTERNAL_CALL_TIMEOUT_MS (`src/telegram/constants.ts`). One posts request runs connect, resolve, up to POSTS_MAX_MESSAGES / POSTS_PAGE_SIZE page fetches and a truncation probe in sequence. So in the worst case the server-side time is well above the suggested client timeout.
   - Classification: doc wrong, code right (advisory, low)
   - Action: drop the fixed number, or state that the client timeout should exceed the worst-case sequential Telegram time.

## Verified Accurate

- REST surface: `health`, `auth`, `me` and `channel/:channelUsername/posts` in `src/telegram/telegram.controller.ts` match `CLAUDE.md`, `README.md`, `DEPLOYMENT.md` and `examples/test-api.http`. `/me` returns `failed` for a missing, unknown or rejected session, and throws 503 and 429 otherwise (`telegram.controller.ts:182-186`, `telegram.service.ts:483-501`).
- Headers: `x-api-key` and `x-session-string` (`src/shared/constants/http.constants.ts`) are used correctly in every doc and example. No example puts the session string in a URL. `x-api-key` is missing only from the health request in `examples/test-api.http:54`, which is correct.
- Perimeter: the health probe is public through `@PublicRoute()`. Every other route is guarded by `ApiKeyGuard` (401), `RateLimitGuard` and `PhoneRateLimitGuard` (`src/telegram/telegram.module.ts`). A 429 from the rate limit carries the `Retry-After` header and `retryAfterSeconds` in the body (`src/shared/utils/rate-limit-response.ts`). A 429 from a Telegram flood wait carries `retryAfterSeconds` in the body.
- Limits: 60 requests per minute per key and 5 per hour per phone (`src/shared/constants/rate-limit.constants.ts`). `hoursBack` accepts 1 to 720 with a default of 24 (`src/telegram/dto/messages.dto.ts`). POSTS_MAX_MESSAGES = 1000 and SESSION_CACHE_MAX_ENTRIES = 50 (`src/telegram/constants.ts`). The response contains `posts`, `count` and `isTruncated` (`message.interface.ts`). README, CHANGELOG and the rule Constants blocks (`runtime-resources.md`, `api-security.md`) all match these values.
- Environment variables: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `PORT`, `CORS_ALLOWED_ORIGINS` and `API_KEYS` match `src/config/*.config.ts` and `src/main.ts`. An empty or unset `API_KEYS` closes the routes. An empty `CORS_ALLOWED_ORIGINS` allows no browser origin, and `*` is ignored. Boot succeeds without the Telegram credentials.
- Deployment: `railway.toml` uses RAILPACK, starts with `npm run start:prod`, sets `internal_port = 8080` and uses `healthcheck_path = /telegram/health`. `DEFAULT_PORT` is 8080 and the server binds 0.0.0.0 (`src/main.ts`).
- Session model: `CLAUDE.md` and `DEPLOYMENT.md:62-64` describe the file-backed store in `data/` honestly (`sessions.json`, and `auth-states.json` keyed by phone number). `data/` is git-ignored (`.gitignore:44`).
- Logging claim (`DEPLOYMENT.md:72`): no Logger call interpolates a phone number or a session string.
- npm scripts: every command in `CLAUDE.md` Quick Commands and in the README command block exists in `package.json`.
- Links: every markdown link in `README.md`, `DEPLOYMENT.md`, `CLAUDE.md` and `docs/integrations/*.md` resolves. The `(ссылка)` match in `n8n-workflow-guide.md:167` is prompt text inside a code block, not a link.
- `examples/client.js`: sends `null` for absent `phoneCode` and `password`. `@IsOptional()` skips validation for `null`, and the service treats it as absent, so the flow works.
- Inventories: 15 agent files match the 15 agents listed in `CLAUDE.md` and `.claude/rules/index.md`. 15 skill directories, each with a `SKILL.md`, match both lists.
- Version: `package.json` has `1.4.1`, the branch is `r-1.4.1`, and the top `CHANGELOG.md` entry is `[1.4.1] 24.09.2026` (today). Its top bullet covers the repository cleanup. All three gates of `.claude/rules/versioning-changelog.md` pass.
