---
name: reference-recurring-exposure-patterns
description: Exposure patterns that keep reappearing in this repo across audits, and the non-obvious framework behaviours that decide whether a perimeter control actually holds
metadata:
  type: reference
---

Patterns seen in more than one audit of `tg-parser`. Check these first; they are cheaper to find here
than by re-deriving them from source each time.

- The perimeter and the credential hygiene drift apart. Guards, DTOs and headers in `src/shared/` and
  `src/telegram/telegram.controller.ts` are written to the rules; `src/telegram/telegram.service.ts` is
  legacy and is where the credentials leak (stdout prefixes, plaintext files, raw MTProto text in
  responses). Audit the service body even when the change under review never touched it.
- Root-level markdown (`README.md`, `USAGE.md`, `HOW_TO_USE_API.md`, `QUICKSTART.md`, `START_HERE.md`,
  `TODO_FOR_USER.md`, `FIX_2FA_ERROR.md`, `PROJECT_STRUCTURE.md`, `pln.md`) documents the pre-hardening
  contract and is never updated with the code. `docs/testing/` is kept current; the root set is not.
  Treat stale docs that instruct a credential into a URL as a finding, not as noise.
- Values in committed docs and Postman variables have always been placeholders or empty. `/data/` and
  `.env` have never been committed on any branch. Re-verify cheaply, do not assume a breach.

Framework behaviour that decides whether a control holds (verified while auditing, not obvious from
project source):

- `APP_GUARD` providers are application-scoped no matter which module declares them, and the array order
  in that module's `providers` is the execution order. Guards declared in `TelegramModule` therefore
  cover any future module too.
- Guards run before pipes. Anything a guard reads from `request.body` is unvalidated and untransformed,
  and any counter a guard increments is charged even to requests the `ValidationPipe` will reject.
- `ValidationPipe` with `forbidNonWhitelisted` only rejects an unknown query parameter on a route that
  actually binds a `@Query()` DTO. A route without one ignores the query string silently.

Related: [[project-audit-history]], [[reference-perimeter-verification-facts]].
