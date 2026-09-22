---
name: project-audit-history
description: Dates and scope of past security audits, the report paths, and which findings were left open so a later audit appends instead of repeating
metadata:
  type: project
---

Audit log for this agent. Newest first. Reports live in `docs/reviews/security-audit-YYYY-MM-DD.md`
(append a section when the file for that date already exists).

- 2026-09-22 — block-01-bootstrap Finalize audit → `docs/reviews/security-audit-2026-09-22.md`.
  Scope: bootstrap, CORS loader, HTTP pipeline, process handlers, auth/messages DTOs.
  Verdict: not safe to keep publicly exposed, but for carried reasons, not block-01 ones.
  Left open and worth re-checking next time:
  HIGH-1 `GetPostsDto` declared but bound to no route (scheduled in block-02 phase-03);
  MEDIUM body-size limit bypassed by non-JSON content types;
  MEDIUM duplicate shutdown path (`enableShutdownHooks` plus custom signal handlers);
  MEDIUM no timeout / no re-entry guard on `closeApplication`;
  MEDIUM `express` imported directly but undeclared in `package.json`;
  MEDIUM 13 npm advisories, all fixed only by `@nestjs/*` majors.

**Why:** the Finalize gate of every block runs this audit, so findings accumulate across blocks and the
same carried risks (no caller auth, session string in the URL, file-backed session store, `console.*` in
`telegram.service.ts`) would otherwise be re-litigated as new every time.

**How to apply:** before auditing, read the newest report in `docs/reviews/`; report carried risks as
context with their owning block, and spend the audit effort on what the current change introduced.
Related: [[reference-perimeter-verification-facts]].
