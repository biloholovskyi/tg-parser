---
name: audit-security
description: Run the refactor and security audit checklist for a target module or changeset
---

# /audit-security

## Instructions

Run the audit per `.claude/rules/refactor-security-audit.md`. For a security-only pass, or whenever the perimeter is in scope, delegate to the `security-auditor` agent (`.claude/agents/security-auditor.md`) and let it produce the report.

1. Scope the target files (from `$ARGUMENTS`, or ask).
2. Load `.claude/rules/patterns.md`, `.claude/rules/architecture.md`, `.claude/rules/telegram.md`, `.claude/rules/api-security.md`.
3. Run the structure audit: mixed concerns, long functions, deep nesting, repeated literals, new `any`, missing validators.
4. Run the perimeter audit (`.claude/rules/api-security.md`):
   - Every endpoint except the health probe requires caller authentication.
   - Every endpoint has a rate limit; the auth endpoint is limited per phone number, not only per caller.
   - No credential in a path, a query string, or a redirect.
   - CORS restricted to an explicit allowlist, not a wildcard.
   - A global `ValidationPipe` is actually applied through `configureHttpPipeline` (`src/shared/utils/http-pipeline.ts`, called from `src/main.ts`), and every DTO carries decorators.
   - Error responses disclose neither account existence nor raw MTProto text.
5. Run the secret audit:
   - No log path reaching a session string, API hash, phone number, SMS code, 2FA password, or private-channel payload. A prefix or a length counts as exposure.
   - `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` read only through `src/config/`.
   - No credential written to a file; any runtime state directory is git-ignored.
   - Tracked files and git history free of credentials.
6. Run the Telegram and resource audit:
   - GramJS confined to `src/telegram/`; no `TelegramClient` built elsewhere.
   - Every client-creating path has a disconnect path, including error branches.
   - Caches bounded with an idle TTL; eviction disconnects.
   - GramJS options set explicitly from named constants (`.claude/rules/runtime-resources.md`).
   - Telegram failures mapped to explicit HTTP statuses; no raw MTProto error returned.
   - No immediate retry on a flood wait; no unbounded parallelism on one account.
   - No `eval` / `new Function` / dynamic require on user input.
   - Lockfile-enforced installs (`npm ci`) in CI and deploy.
7. Extract magic numbers and strings with 2+ uses.
8. Split files when concerns are mixed (service vs types vs utils).
9. Enforce `import type` for type-only symbols.
10. After fixes, rerun `rtk npm run lint && rtk npm run build && rtk npm test`.

## Output

- Findings grouped by severity (CRITICAL > HIGH > MEDIUM > LOW) with file paths.
- Refactors applied (or proposed) and residual risks.
- Validation command output.
- Never quote a real credential value; describe its location instead.

## Arguments

- `$ARGUMENTS` — target module, file path, or glob. If omitted, ask for scope.
