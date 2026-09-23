---
paths:
  - "src/**/*.ts"
  - "src/**/*.module.ts"
  - "src/**/*.controller.ts"
  - "src/**/*.service.ts"
---
# tg-parser Architecture

NestJS REST API that wraps GramJS (a Telegram MTProto client library) to read public and private channels through a personal Telegram user account, not a bot. No database, no ORM, no persistence layer.

## Request Flow

`TelegramController` (REST) → `TelegramService` (GramJS logic) → Telegram MTProto API

## Module Structure

Every feature module contains:

- `*.module.ts` — module declaration, imports, providers, exports
- `*.controller.ts` — REST `@Controller()` with `@Get/@Post/@Put/@Patch/@Delete`
- `*.service.ts` — business logic; all GramJS calls live here
- `dto/` — request DTOs with `class-validator` decorators
- `interfaces/` — response shapes and domain types
- optional `constants.ts`, `utils/` for module-local helpers

Controllers must be thin — delegate all logic to the service. Follow the pattern of the existing `src/telegram/` module.

## Key Directories

- `src/telegram/` — the single feature module: auth, session checks, channel post fetching
- `src/config/` — env-backed configuration loaders (`telegram.config.ts`, `cors.config.ts`, `api-keys.config.ts`)
- `src/shared/` — cross-cutting helpers: `constants/` (`http.constants.ts`, `rate-limit.constants.ts`), `utils/` (`http-pipeline.ts`, `process-handlers.ts`, `rate-limit-store.ts`, header readers), `guards/` (caller authentication and rate limits), `decorators/` (route markers and the session parameter), `exceptions/` (the 429 response)
- `src/app.module.ts` — root module
- `src/main.ts` — bootstrap: creates the app with `bodyParser: false`, calls `configureHttpPipeline`, registers process handlers and shutdown hooks, binds the port

Cross-cutting helpers stay in `src/shared/` under `constants/`, `types/`, `utils/`, `guards/`, `decorators/` and `exceptions/` rather than scattered into feature modules. The perimeter guards live there and are registered as `APP_GUARD` from `src/telegram/telegram.module.ts`.

## REST Surface

Base path `telegram`:

- `GET /telegram/health` — liveness probe, also the Railway health check target
- `POST /telegram/auth` — multi-step auth: phone number, then SMS code, then optional 2FA password; returns a `sessionString`
- `GET /telegram/me` — session validity and current account info, credential in SESSION_HEADER
- `GET /telegram/channel/:channelUsername/posts` — time-filtered posts for a channel, credential in SESSION_HEADER, window in `hoursBack`

Contract changes to any of these are governed by `.claude/rules/api-contracts.md`.

## Session Model (critical)

- `TelegramClient` instances are cached in memory in a `Map<sessionString, TelegramClient>` inside `TelegramService`.
- There is no database: every cached client and every issued session is lost on process restart, and a restart forces callers to re-authenticate or re-supply their `sessionString`.
- The cache is bounded, idle entries are evicted, and eviction disconnects the client. Ceilings and TTLs are in `.claude/rules/runtime-resources.md`.
- The cache is per-process. Any horizontal scaling of the service breaks session affinity; treat multi-instance deployment as a design change, not a config change.
- The deployment filesystem is ephemeral, so disk is never part of the session model.
- A file-backed session store currently exists in the code against this model; it is an open decision recorded under Known Deviations in `.claude/rules/telegram.md`.
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
- GramJS clients are created and owned by `TelegramService`; no other class instantiates a `TelegramClient`.

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
