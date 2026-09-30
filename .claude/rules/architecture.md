---
paths:
  - "src/**/*.ts"
  - "src/**/*.module.ts"
  - "src/**/*.controller.ts"
  - "src/**/*.service.ts"
---
# tg-parser Architecture

NestJS REST API that wraps GramJS (a Telegram MTProto client library) to read public and private channels through a personal Telegram user account, not a bot. No database, no ORM; issued sessions are persisted, encrypted, in Redis.

## Request Flow

`TelegramController` (REST) → `TelegramService` (facade) → `AuthService` / `ChannelService` → `SessionStore` → `SessionRepository` (Redis) / Telegram MTProto API

`DigestController` / `DigestScheduler` → `DigestService` → `PostCollector` (through `TelegramService`) → `TranslationService` / `SummaryService` (`GrokClient`) → `BotNotifier` (Telegram Bot API)

## Module Structure

Every feature module contains:

- `*.module.ts` — module declaration, imports, providers, exports
- `*.controller.ts` — REST `@Controller()` with `@Get/@Post/@Put/@Patch/@Delete`
- `*.service.ts` — business logic; GramJS calls stay in the module's services and its client-lifecycle classes (in `src/telegram/`: `SessionStore`, `TelegramClientFactory`)
- `dto/` — request DTOs with `class-validator` decorators
- `interfaces/` — response shapes and domain types
- optional `constants.ts`, `utils/` for module-local helpers

Controllers must be thin — delegate all logic to the service. Follow the pattern of the existing `src/telegram/` module.

## Key Directories

- `src/telegram/` — Telegram account access: `telegram.service.ts` (facade, session check, shutdown order), `auth.service.ts` (multi-step auth, pending attempts), `channel.service.ts` (paged walk), `session-store.ts` (client lifecycle owner), `session-repository.ts` (encrypted session records and the digest mark), `telegram-client.factory.ts` (the only `TelegramClient` constructor); module-local `constants.ts` and `utils/` (`session-client-cache.ts`, `telegram-errors.ts`, `with-timeout.ts`, `message.mapper.ts`)
- `src/digest/` — daily digest: `digest.service.ts` (run orchestration, one run at a time), `digest.scheduler.ts` (daily job), `digest.controller.ts`, `post-collector.ts`, `translation.service.ts`, `summary.service.ts`, `bot-notifier.ts`, `grok/` (client, prompts, schemas), `utils/` (formatter, splitter, coverage); GramJS is never imported here
- `src/redis/` — the only Redis client (`redis-client.ts`) and its module, closed on application shutdown
- `src/config/` — env-backed configuration loaders (`telegram.config.ts`, `cors.config.ts`, `api-keys.config.ts`, `redis.config.ts`, `digest.config.ts`)
- `src/shared/` — cross-cutting helpers: `constants/` (`http.constants.ts`, `rate-limit.constants.ts`, `channel-username.constants.ts`), `utils/` (`http-pipeline.ts`, `process-handlers.ts`, `rate-limit-store.ts`, `secret-cipher.ts`, header readers), `guards/` (caller authentication and rate limits), `decorators/` (route markers and the session parameter), `exceptions/` (the 429 response)
- `src/app.module.ts` — root module
- `src/main.ts` — bootstrap: creates the app with `bodyParser: false`, calls `configureHttpPipeline`, registers the process handlers that own the single shutdown path (Nest `enableShutdownHooks` is deliberately not used), binds the port

Cross-cutting helpers stay in `src/shared/` under `constants/`, `utils/`, `guards/`, `decorators/` and `exceptions/` rather than scattered into feature modules. The perimeter guards live there and are registered as `APP_GUARD` from `src/telegram/telegram.module.ts`.

## REST Surface

Base paths `telegram` and `digest`:

- `GET /telegram/health` — liveness probe, also the Railway health check target
- `POST /telegram/auth` — multi-step auth: phone number, then SMS code, then optional 2FA password; returns a `sessionString`
- `GET /telegram/me` — session validity check returning `{ status: 'success' | 'failed' }`, credential in SESSION_HEADER; transport failures and flood waits are thrown as mapped HTTP errors, not reported as `failed`
- `GET /telegram/channel/:channelUsername/posts` — time-filtered posts for a channel, credential in SESSION_HEADER, window in `hoursBack`; returns `GetPostsResponse` (`posts`, `count`, `isTruncated`)
- `PUT /digest/session` — marks the session in SESSION_HEADER as the digest account after checking it with Telegram; 204
- `POST /digest/run` — starts a digest run in the background; 202 `DigestRunResponse`, 409 while running, 503 when unconfigured

Contract changes to any of these are governed by `.claude/rules/api-contracts.md`.

## Session Model (critical)

- `TelegramClient` instances are cached in memory in a `SessionClientCache` (`src/telegram/utils/session-client-cache.ts`, backed by a `Map` keyed by `sessionString`) owned by `SessionStore`, which alone connects and releases clients.
- Issued sessions are recorded by `SessionRepository` in Redis: the value is the session encrypted with AES-256-GCM under `SESSION_ENCRYPTION_KEY`, the key is its SHA-256, the record lives SESSION_STORE_TTL_S and is extended on use. A cache miss reconnects the client from the record, so a restart needs no re-authentication.
- Without `REDIS_URL` or a valid key, the repository is memory only: every session is lost on restart, as the fallback.
- The cache is bounded (least recently used entry evicted at the ceiling), idle entries are swept out, and every eviction releases the client with `destroy()`. Ceilings and TTLs are in `.claude/rules/runtime-resources.md`.
- The cache is per-process. Any horizontal scaling of the service breaks session affinity; treat multi-instance deployment as a design change, not a config change.
- The deployment filesystem is ephemeral, so disk is never part of the session model.
- Pending logins (between code sent and signed in) are held in memory by `AuthService` and expire after AUTH_STATE_TTL_MS.
- Redis persistence is a recorded user decision (`docs/plans/block-10-daily-digest/adr-session-redis.md`).
- Session handling rules, including connection lifecycle and secret hygiene, are in `.claude/rules/telegram.md`.

## Validation and Error Handling

- Request DTOs live in `dto/` and carry `class-validator` decorators.
- A global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted` and `transform` is built in `src/shared/utils/http-pipeline.ts` and applied by `configureHttpPipeline(app)`, which `src/main.ts` calls. Without it, DTO decorators are inert and the service is unvalidated — verify the wiring before relying on any DTO.
- The perimeter itself (caller authentication, rate limits, CORS, credential transport) is governed by `.claude/rules/api-security.md`.
- Throw NestJS exceptions (`BadRequestException`, `UnauthorizedException`, `NotFoundException`, and so on) — never bare `Error` — so status codes are correct.
- Telegram-side failures (flood wait, expired code, invalid session) map to explicit HTTP statuses, never to a generic 500.

## Dependency Injection

- All services `@Injectable()`.
- Constructor injection only — no property injection, no module-level singletons.
- Cyclic imports between modules are forbidden; extract shared types and constants to `src/shared/`.
- GramJS clients are constructed only by `TelegramClientFactory` and owned by `SessionStore`; no other class instantiates, connects or releases a `TelegramClient`.

## Module Checklist for New Features

- [ ] `*.module.ts` with explicit `imports`, `providers`, `exports`
- [ ] `*.controller.ts` — thin, delegates to the service
- [ ] `*.service.ts` — `@Injectable()`, owns the external-API calls
- [ ] `dto/` for request DTOs with `class-validator`
- [ ] `interfaces/` for response shapes
- [ ] Registered in `src/app.module.ts`
- [ ] Errors mapped to NestJS exceptions, no secrets in logs
- [ ] Endpoint authentication and rate limit decided (`.claude/rules/api-security.md`)
- [ ] Every resource the module opens has a ceiling and a release path (`.claude/rules/runtime-resources.md`)
- [ ] Tests added for service methods and controller routes (`.claude/rules/testing.md`)

## Related Rules

- `.claude/rules/telegram.md` — GramJS, MTProto, sessions, secrets
- `.claude/rules/api-security.md` — perimeter authentication, rate limits, CORS
- `.claude/rules/runtime-resources.md` — resource ceilings, environment constraints, cost
- `.claude/rules/patterns.md` — code patterns and limits
- `.claude/rules/typescript.md` — TS config and decorators
- `.claude/rules/api-contracts.md` — REST contract changes
- `.claude/rules/testing.md` — mandatory test coverage
