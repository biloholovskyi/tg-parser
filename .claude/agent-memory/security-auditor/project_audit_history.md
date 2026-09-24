---
name: project-audit-history
description: Dates and scope of past security audits, the report paths, and which findings were left open so a later audit appends instead of repeating
metadata:
  type: project
---

Audit log for this agent. Newest first. Reports live in `docs/reviews/security-audit-YYYY-MM-DD.md`
(append a section when the file for that date already exists).

- 2026-09-24 — block-08-09-refactor-strictness-storage (uncommitted) → `docs/reviews/block-08-09-security-audit.md`.
  Closed: file-backed `data/` store (ADR: memory only, user decision), substring error classification.
  New open: M1 pending-login state keyed by phone is dropped/deleted without ownership check
  (`auth.service.ts` catch + `completeLogin`) — concurrent same-phone requests can orphan a connected
  client; M2 evicted sessions never `auth.LogOut` (orphaned live authorizations). Still carried: H1 no
  ceiling on pending logins, wrong code/password drops state, npm advisories (40 / 13 runtime).
  Verdict: OK only behind trusted API keys.

- 2026-09-23 — block-03-05-telegram-service (uncommitted diff) → `docs/reviews/block-03-05-security-audit.md`
  (caller-chosen path, not the dated file). Closed: session-prefix logging, raw MTProto text in bodies,
  phone numbers in logs. New open: M1 error classification by message substring (GramJS echoes the
  channel username, so usernames like invalid-session codes spoof 401/429/503 + evict); M2 `*_FLOOD`
  codes fall to 502; L1 service 429 lacks Retry-After; L2 PHONE_NUMBER_BANNED oracle. Still carried:
  file store (C1), unbounded pending-auth map (H1), wrong code kills auth state (extra SMS).

- 2026-09-23 — block-02-api-perimeter audit → `docs/reviews/security-audit-2026-09-23.md`.
  Scope: the three `APP_GUARD` guards, rate-limit store, header readers, route/metadata decorators,
  `api-keys.config.ts`, controller and DTOs, `docs/testing/` artifacts.
  Verdict: still not safe to expose publicly, but the perimeter work itself carries no CRITICAL —
  the blockers all sit behind it.
  Closed by block 02 (do not re-report as open): no caller auth, no rate limit, session string in the
  query string, `GetPostsDto` bound to no route, `express` undeclared in `package.json`, duplicate
  shutdown path, missing shutdown timeout and re-entry guard.
  Left open and worth re-checking next time:
  CRITICAL session-string prefix + length logged (`telegram.service.ts` ~197/252, 193/248);
  CRITICAL file-backed store in `data/` (the open user decision);
  HIGH no global cap on `POST /telegram/auth` and FIFO eviction of live phone windows;
  HIGH raw MTProto text in 400/500 bodies (phone-existence oracle);
  HIGH phone numbers and raw error objects logged;
  HIGH root-level docs (`README.md`, `USAGE.md`, `HOW_TO_USE_API.md`, `QUICKSTART.md`, `START_HERE.md`,
  `TODO_FOR_USER.md`, `FIX_2FA_ERROR.md`, `PROJECT_STRUCTURE.md`, `pln.md`) still document the
  session string in the URL and never mention `x-api-key`;
  MEDIUM phone counter incremented before validation and before the SMS decision (lock-out of a victim
  number, and steps 2/3 of a normal login eat the budget);
  MEDIUM phone subject not normalized (`+7…` vs `7…` are two counters);
  MEDIUM `getApiKeysConfig()` re-read and warned per request (log amplification, unauthenticated);
  MEDIUM counters per process (reset on deploy, split under replicas);
  MEDIUM 40 npm advisories, runtime fixes gated behind `@nestjs/*` 12 (was 13 on 2026-09-22);
  LOW chunked body escapes the content-length ceiling; `posts_data/*.json` tracked.

- 2026-09-22 — block-01-bootstrap Finalize audit → `docs/reviews/security-audit-2026-09-22.md`.
  Scope: bootstrap, CORS loader, HTTP pipeline, process handlers, auth/messages DTOs.
  Verdict: not safe to keep publicly exposed, but for carried reasons, not block-01 ones.

**Why:** the Finalize gate of every block runs this audit, so findings accumulate across blocks and the
same carried risks (file-backed session store, `console.*` in `telegram.service.ts`) would otherwise be
re-litigated as new every time.

**How to apply:** before auditing, read the newest report in `docs/reviews/`; report carried risks as
context with their owning block, and spend the audit effort on what the current change introduced.
Related: [[reference-perimeter-verification-facts]].
