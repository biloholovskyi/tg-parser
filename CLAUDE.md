# tg-parser

NestJS 10 service that wraps GramJS (a Telegram MTProto client) to parse public and private Telegram channels through a personal user account, not a bot. REST API, TypeScript 5 on Node 20+. No database.

Session model: process memory only, decided in [adr-session-storage.md](docs/plans/block-08-09-refactor-strictness-storage/adr-session-storage.md). Nothing is written to disk; a restart or deploy drops every session and pending login, and callers authenticate again. Adding any persistence is a new user decision, not a code change.

## Source of Truth

AI rules live under `.claude/rules/`. Claude-native configuration lives under `.claude/` (rules, agents, skills, agent-memory, settings) and is canonical — hand-edited, not generated. There is no separate `ai/` folder.

- Start here: @.claude/rules/index.md (compiled task-map index)
- Always load: @.claude/rules/core-rules.md + @.claude/rules/response-rules.md
- Token discipline: @.claude/rules/token-economy.md
- Tooling / shell: @.claude/rules/tooling.md
- Testing is mandatory: @.claude/rules/testing.md

## Rule Precedence

User instruction in the current turn > project hard rules (`CLAUDE.md`, `.claude/rules/*.md`) > project skills (`.claude/skills/`) > plugin and global skills (`superpowers:*`, `~/.claude/CLAUDE.md`) > model defaults.

Plugin skills never override a project hard rule. Planning, committing, and testing conflicts are already resolved in @.claude/rules/core-rules.md (Rule Precedence) — follow that table instead of re-deciding.

## Hard Rules

- No automatic commits: never run `git commit` on your own — commit ONLY on an explicit user request. This applies to dispatched subagents too. See @.claude/rules/git-conventions.md.
- Every feature and bugfix ships with tests in the same change. See @.claude/rules/testing.md.
- Secrets never reach a log, a test fixture, a report, or a memory file: no `sessionString`, `TELEGRAM_API_HASH`, phone number, SMS code, or 2FA password. See @.claude/rules/telegram.md.
- GramJS stays inside `src/telegram/`. No other module imports the `telegram` package or constructs a `TelegramClient`.
- The REST surface is privileged: every endpoint except the health probe requires caller authentication and a rate limit, and no credential ever travels in a URL. See @.claude/rules/api-security.md.
- Every resource opened at runtime has a ceiling and a release path: bounded caches, eviction that disconnects, cleared timers, explicit GramJS options, no synchronous filesystem access on a request path. A leaked connection is a recurring bill. See @.claude/rules/runtime-resources.md.
- Anything touching auth, sessions, secrets, or the REST perimeter carries a `risks.md` with a rollback move before implementation starts. See @.claude/rules/implementation-plans.md.
- No magic numbers: extract constants for numeric literals >1 (0, 1, -1 OK inline).
- No auto-documentation: only when explicitly requested.
- Communication style is a hard rule, not a preference: reply to the user in Russian always, with brief final answers, plain language, and every non-trivial technical term explained on its first use in a session. See @.claude/rules/response-rules.md.

## Architecture

```
TelegramController (REST) → TelegramService (facade) → AuthService | ChannelService → SessionStore → Telegram MTProto API
```

- `GET /telegram/health` — liveness probe and the Railway health check target
- `POST /telegram/auth` — multi-step auth: phone, SMS code, optional 2FA password; returns a `sessionString`
- `GET /telegram/me` — session validity check, `{ status: 'success' | 'failed' }` (`failed` only when the session is missing, unknown or rejected; transport failure is 503, flood wait 429); the `sessionString` travels in the `x-session-string` header
- `GET /telegram/channel/:channelUsername/posts` — time-filtered posts, `{ posts, count, isTruncated }`, walk capped at `POSTS_MAX_MESSAGES`; the `sessionString` travels in the `x-session-string` header, never in the URL

Every route except the health probe requires an `x-api-key` header and is rate limited.

Session model: `TelegramClient` instances are cached in memory in a `SessionClientCache` (`src/telegram/utils/session-client-cache.ts`, a `Map` keyed by `sessionString`) owned by `SessionStore`, the sole owner of the client lifecycle. Everything is lost on process restart, and the cache is per-process, so horizontal scaling breaks session affinity. The cache is bounded (least recently used entry evicted at the ceiling) and idle clients are swept out; every eviction calls `destroy()` on the client, because every connected client pings Telegram continuously. Details: @.claude/rules/architecture.md and @.claude/rules/runtime-resources.md.

Key source files:

- [src/telegram/telegram.service.ts](src/telegram/telegram.service.ts) — facade for the controller: delegates, session check, shutdown order
- [src/telegram/auth.service.ts](src/telegram/auth.service.ts) — multi-step auth flow and pending login attempts (memory only, TTL-swept)
- [src/telegram/channel.service.ts](src/telegram/channel.service.ts) — paged message walk, time window, walk ceiling
- [src/telegram/session-store.ts](src/telegram/session-store.ts) — sole owner of client connect, cache and release
- [src/telegram/telegram-client.factory.ts](src/telegram/telegram-client.factory.ts) — the only place a `TelegramClient` is constructed, with explicit options
- [src/telegram/utils/message.mapper.ts](src/telegram/utils/message.mapper.ts) — pure MTProto message to `TelegramPost` mapping
- [src/telegram/constants.ts](src/telegram/constants.ts) — cache ceilings and TTLs, timeouts, GramJS client options, walk limits, MTProto error-code lists
- [src/telegram/utils/session-client-cache.ts](src/telegram/utils/session-client-cache.ts) — bounded, idle-swept client cache; eviction releases the client
- [src/telegram/utils/telegram-errors.ts](src/telegram/utils/telegram-errors.ts) — maps Telegram failures to HTTP exceptions and log-safe error descriptions
- [src/telegram/utils/with-timeout.ts](src/telegram/utils/with-timeout.ts) — per-call timeout whose timer is always cleared
- [src/telegram/telegram.controller.ts](src/telegram/telegram.controller.ts) — REST endpoints and request validation
- [src/config/telegram.config.ts](src/config/telegram.config.ts) — loads `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`
- [src/config/cors.config.ts](src/config/cors.config.ts) — loads the `CORS_ALLOWED_ORIGINS` allowlist
- [src/config/api-keys.config.ts](src/config/api-keys.config.ts) — loads the `API_KEYS` caller allowlist
- [src/shared/guards/api-key.guard.ts](src/shared/guards/api-key.guard.ts) — caller authentication; the health probe opts out via `@PublicRoute()`
- [src/shared/guards/rate-limit.guard.ts](src/shared/guards/rate-limit.guard.ts) and [src/shared/guards/phone-rate-limit.guard.ts](src/shared/guards/phone-rate-limit.guard.ts) — per-key and per-phone limits
- [src/shared/utils/rate-limit-store.ts](src/shared/utils/rate-limit-store.ts) — bounded fixed-window counters
- [src/shared/utils/http-pipeline.ts](src/shared/utils/http-pipeline.ts) — body-size limit, global `ValidationPipe`, CORS options; called from `src/main.ts`
- [src/shared/utils/process-handlers.ts](src/shared/utils/process-handlers.ts) — process handlers and the single deliberate shutdown path
- [src/telegram/interfaces/message.interface.ts](src/telegram/interfaces/message.interface.ts) — `TelegramPost`, `TelegramMedia` and `GetPostsResponse` types

## Quick Commands

Always prefix with `rtk`. This project uses npm, never pnpm or yarn.

- `rtk npm run start:dev` — dev server with watch mode
- `rtk npm run build` — compile TypeScript to `dist/`
- `rtk npm run lint` — ESLint with auto-fix
- `rtk npm run typecheck` — type-only check
- `rtk npm test` — Jest unit tests
- `rtk npm run test:e2e` — E2E suite

## Load Rules by Task

| Task | Load |
|------|------|
| Adding or changing a feature module | `.claude/rules/architecture.md` |
| Telegram, GramJS, sessions, MTProto errors | `.claude/rules/telegram.md` |
| Applying project code patterns | `.claude/rules/patterns.md` |
| TypeScript types, strictness, decorators | `.claude/rules/typescript.md` |
| REST endpoint, DTO, or response contract | `.claude/rules/api-contracts.md` |
| Endpoint auth, rate limits, CORS, credential transport | `.claude/rules/api-security.md` |
| Caches, connections, timers, cost, runtime environment | `.claude/rules/runtime-resources.md` |
| Writing or changing tests | `.claude/rules/testing.md` |
| Auditing test coverage | `.claude/rules/test-coverage-audit.md` |
| Finishing a code change (QA pass) | `.claude/rules/post-code-workflow.md` |
| Running a project command | `.claude/rules/tooling.md` |
| Writing an implementation plan | `.claude/rules/implementation-plans.md` |
| Executing an implementation plan | `.claude/rules/plan-execution.md` |
| Auditing an implementation plan | `.claude/rules/plan-audit.md` |
| Plan completion report | `.claude/rules/report-generation.md` |
| Committing | `.claude/rules/git-conventions.md` |
| Commit metadata and crosslinks | `.claude/rules/commit-message-and-crosslinks.md` |
| Version bump or changelog entry | `.claude/rules/versioning-changelog.md` |
| Refactor or security review | `.claude/rules/refactor-security-audit.md` |
| Checking that rules and docs still match the code | `.claude/rules/drift-audit.md` |
| Answering the user | `.claude/rules/response-rules.md` |
| Managing the context budget | `.claude/rules/token-economy.md` |
| Entry point, always loaded | `.claude/rules/core-rules.md` |

`.claude/rules/*.md` carry a `paths:` frontmatter so Claude can auto-load them when an edit touches matching paths.

## Skills

Invoke via `/skill-name`:

- `/post-code` — full QA pass: lint, build, test
- `/commit` — conventional commit with version and changelog gates
- `/lint`, `/test`, `/build`, `/typecheck` — individual QA steps
- `/start-task` — classify a task and initialize a plan when needed
- `/implement-plan-step` — execute one plan phase with gates
- `/write-tests` — author tests via the `test-writer` agent
- `/audit-plan`, `/audit-security` — audits
- `/audit-resources` — leak, resource and cost audit
- `/audit-drift` — rules and docs versus code
- `/debug` — systematic root-cause investigation with a mandatory regression test
- `/plan-report` — plan completion report and reports index

Skill definitions: `.claude/skills/<name>/SKILL.md`.

## Agents

Specialized agent definitions under `.claude/agents/`:

- `tg-parser-backend-expert` — primary implementer: REST features, GramJS work, refactors
- `test-writer` — authors Jest unit and Supertest E2E tests
- `code-reviewer` — review of recently written or uncommitted code
- `codebase-researcher` — read-only codebase discovery
- `command-runner` — runs lint/build/test off the main thread
- `dependency-analyst` — dependency and version-alignment analysis
- `plan-auditor` — read-only implementation-plan audit
- `test-coverage-auditor` — Jest coverage gaps
- `parallel-tester` — parallel Jest runs
- `full-package-auditor` — dependencies, quality, security, coverage in one report
- `security-auditor` — perimeter, secret hygiene and credential transport
- `resource-leak-auditor` — connections, caches, timers, synchronous I/O, runtime cost
- `docs-drift-auditor` — rules and `CLAUDE.md` versus the code
- `debugger` — systematic root-cause investigation
- `report-writer` — plan-completion report author

Agent memory lives at `.claude/agent-memory/<agent>/MEMORY.md`.

## Deployment

Railway via [railway.toml](railway.toml): RAILPACK builder, `npm run start:prod`, health check at `/telegram/health`, port 8080. Deployment is intentionally not governed by a Claude rule file or an MCP server in this project — deploy changes are made by hand.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_API_ID` | Numeric API ID from my.telegram.org |
| `TELEGRAM_API_HASH` | 32-char API hash from my.telegram.org |
| `PORT` | HTTP port (default 8080, matching `internal_port` in `railway.toml`) |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origin allowlist for CORS; empty or unset means no browser origin is allowed, and `*` is ignored |
| `API_KEYS` | Comma-separated caller API keys checked against the `x-api-key` header; empty or unset closes every endpoint except the health probe |

Credentials are read only through `src/config/telegram.config.ts`. Boot does not fail when they are missing — the health endpoint stays up and the failure surfaces on first real use.

## Guards

`.claude/hooks/guard-secrets.js` runs as a `PreToolUse` hook from `.claude/settings.json`. It blocks writing into `data/`, editing `.env`, and writing any session string, API hash, or phone number into a repository file. A blocked call is not a suggestion to work around it.

## MCP

`.mcp.json` declares `context7` (library documentation lookups, useful for GramJS and NestJS APIs).
