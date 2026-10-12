---
name: reference-perimeter-verification-facts
description: Verified runtime behaviour of the express/cors/Nest versions this project pins — facts about the HTTP perimeter that reading project source alone does not reveal
metadata:
  type: reference
---

Verified by experiment on 2026-09-22 against the installed dependency tree (Nest 10.4.20, express 4).
Re-verify after any framework major, because all three facts are library behaviour, not project code.

- `cors` with an empty origin array fails closed: no `Access-Control-Allow-Origin` header on a normal
  request, preflight answered 204 without the header. So an unset `CORS_ALLOWED_ORIGINS` denies browsers
  instead of allowing them.
- `express.json()` / `urlencoded()` enforce their `limit` only for their own content types. With
  `bodyParser: false` and no catch-all parser, a large `text/plain` or `application/octet-stream` body is
  accepted with no 413 — the body-size ceiling is content-type scoped, not per route.
- `app.enableShutdownHooks()` installs its own SIGTERM/SIGINT listener that runs the lifecycle hooks and
  then re-raises the signal via `process.kill` (`node_modules/@nestjs/core/nest-application-context.js`).
  Any additional custom signal handler therefore races it.

**How to re-verify:** a throwaway script in the session scratchpad with
`NODE_PATH=C:\Projects\tg-parser\node_modules node <script>` — never inside the repository, and never
against real Telegram credentials.
