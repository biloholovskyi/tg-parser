[1.4.1] 24.09.2026

- Sessions and pending logins kept in process memory only: the JSON files under data/ are no longer read or written, and a restart requires authenticating again
- Telegram module split into AuthService, ChannelService, SessionStore, a single client factory and a pure message mapper; behaviour of the endpoints unchanged
- TypeScript strictNullChecks, noImplicitAny and strictBindCallApply enabled
- Repository cleanup: one-off root docs removed, deployment guide rewritten for the current API, n8n guides moved to docs/integrations, examples send the session in the x-session-string header, exported posts no longer tracked
- Test coverage: TelegramService, TelegramController and request DTOs fully unit tested; E2E covers the full auth cycle and proves no real Telegram client is created
- Service logs go through the NestJS Logger only: one outcome line per request, no phone numbers or session strings, console banned by ESLint in src
- Channel posts are walked page by page up to POSTS_MAX_MESSAGES and the response reports isTruncated; Telegram failures map to 401, 404, 400, 429, 502, 503
- Telegram client cache bounded by SESSION_CACHE_MAX_ENTRIES with idle eviction; evicted and shut-down clients are destroyed, GramJS options set explicitly
- Session string moved from the query string into the x-session-string header
- Request DTOs for channel posts, and the 2FA password accepted only with a code
- Rate limits: 60 requests per minute per API key and 5 auth requests per hour per phone number
- Caller authentication by API key on every route except the health probe

[1.4.0] 22.09.2026

- Health probe reduced to a single constant route at /telegram/health
- Background promise rejections no longer terminate the process
- CORS restricted to an explicit origin allowlist from CORS_ALLOWED_ORIGINS
- Global request validation and a 16 KB request body limit

[1.3.1] 13.04.2026

- Pending auth steps and issued session strings saved to JSON files under data/, so a code confirmation and cached sessions survive a process restart
- Full session strings no longer printed when looking up a cached client

[1.1.1] 13.04.2026

- Setting claude code

[1.1.0] 07.04.2026

- Get me, check session status

[1.0.1] 31.03.2026

- Fix memory leak
