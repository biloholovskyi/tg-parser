# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev       # Hot-reload dev server
npm run start:debug     # Debug mode with watch

# Build & Production
npm run build           # Compile TypeScript → dist/
npm run start:prod      # Run compiled output

# Code Quality
npm run lint            # ESLint with auto-fix
npm run format          # Prettier formatting
```

No test runner is configured in this project.

## Architecture

NestJS service that wraps GramJS (Telegram MTProto client) to parse public and private Telegram channels via a personal user account (not a bot).

**Request flow:**
```
TelegramController (REST) → TelegramService (GramJS logic) → Telegram MTProto API
```

**Two core endpoints:**
1. `POST /telegram/auth` — Multi-step auth (phone → SMS code → optional 2FA password). Returns a `sessionString`.
2. `GET /telegram/channel/:username/posts` — Fetch time-filtered posts using a `sessionString`.

**Session model:** `TelegramClient` instances are cached in-memory in a `Map<sessionString, TelegramClient>`. Sessions are lost on process restart — there is no database or persistence layer.

**Key source files:**
- [src/telegram/telegram.service.ts](src/telegram/telegram.service.ts) — Core GramJS logic (~530 LOC): authentication flow, client caching, message iteration and filtering
- [src/telegram/telegram.controller.ts](src/telegram/telegram.controller.ts) — REST endpoints and request validation
- [src/config/telegram.config.ts](src/config/telegram.config.ts) — Loads `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` from env
- [src/telegram/interfaces/message.interface.ts](src/telegram/interfaces/message.interface.ts) — `TelegramPost` and `TelegramMedia` types

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_API_ID` | Numeric API ID from my.telegram.org |
| `TELEGRAM_API_HASH` | 32-char API hash from my.telegram.org |
| `PORT` | HTTP port (default 3000; Railway overrides to 8080) |

## Deployment

Configured for Railway via [railway.toml](railway.toml) (RAILPACK builder, `npm run start:prod`, health check at `/telegram/health`).
