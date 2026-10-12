---
paths:
  - "src/**/*"
  - "test/**/*"
---
# Skill: Refactor and Security Audit

Use when refactoring files for structure, constants, exported types, and security hardening.
Canonical checklist for the audit item of the Finalize phase in `.claude/rules/implementation-plans.md`.

Triggers:
- User asks for a refactor, cleanup, quality improvement, or file audit
- User asks to split module code into constants, types, utils, validators
- User asks to find magic numbers or strings and extract constants
- User asks for a security audit
- Changes touch multiple files or introduce new patterns
- An implementation plan reaches its Finalize audit item

## Process

- Scope the target files; load `.claude/rules/patterns.md`, `.claude/rules/architecture.md`, `.claude/rules/telegram.md`
- Audit against the maintainability limits in `.claude/rules/patterns.md`
- Structure audit: mixed concerns in one file, long functions and classes, repeated literals, deep nesting
- Extract literals: move repeated numeric and string literals to named constants with units and context
- Split modules:
  - Runtime logic in `*.service.ts` and `*.controller.ts`
  - Request shapes in `dto/`, response shapes in `interfaces/`
  - Pure helpers in `src/shared/utils/` or a module-local `utils/`
  - Constants in `src/shared/constants/` or a module-local `constants.ts`
- Enforce `import type` / `export type` for type-only symbols
- Fix type issues: remove `any`, add missing types, narrow GramJS results at the service boundary
- Reduce nesting and break up large functions per the limits in `.claude/rules/patterns.md`
- Validate NestJS boundaries using `.claude/rules/architecture.md` (thin controllers, logic in services, no circular module imports)
- Run the security pass (OWASP ASVS-aligned):
  - Perimeter first (`.claude/rules/api-security.md`): every non-health endpoint authenticated, rate limited, CORS restricted to an allowlist, no credential in a URL
  - Validate inputs at boundaries (`class-validator` on DTOs, global `ValidationPipe` actually applied via `configureHttpPipeline` in `src/shared/utils/http-pipeline.ts`, called from `src/main.ts`)
  - Never log secrets: session strings, API hash, phone numbers, SMS codes, 2FA passwords, private-channel payloads
  - Credentials read only through `src/config/`, never inline `process.env`
  - No `eval` / `new Function` / dynamic require on user input
  - Confirm no GramJS import or `TelegramClient` construction outside `src/telegram/`
  - Confirm every client-creating path has a disconnect path
  - Confirm no runtime state file holds a credential, and that its directory is git-ignored
  - `npm ci` (lockfile-enforced) in CI; `rtk npm audit` reviewed locally
- Run the resource pass (`.claude/rules/runtime-resources.md`): cache ceilings and TTLs, eviction disconnects, cleared timers, explicit GramJS options, no synchronous I/O on a request path, no `process.exit` in a generic handler, bounded log volume
- Prefer automated guardrails (ESLint, Prettier) before manual review
- After fixes, rerun `rtk npm run lint && rtk npm run build && rtk npm test`

## Checklist

- [ ] No new `any` types in changed files
- [ ] No magic numbers with 2+ uses (inline 0/1/-1 OK)
- [ ] No magic strings with 2+ uses
- [ ] Functions <= 20 lines (refactor at 30)
- [ ] Max nesting <= 3
- [ ] Services inject dependencies via constructor, never module-level instantiation
- [ ] Controllers thin; business logic in services
- [ ] Request DTOs use `class-validator`
- [ ] No `console.log` in committed code (use the NestJS `Logger`)
- [ ] No session string, credential, phone number, or code reachable by any log statement
- [ ] `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` read only through `src/config/`
- [ ] GramJS confined to `src/telegram/`
- [ ] Every created `TelegramClient` has a disconnect path, including error paths
- [ ] Every cache of live objects has a maximum size and an idle TTL, and eviction disconnects
- [ ] Every timer created on a request path is cleared when the path settles
- [ ] GramJS client options set explicitly from named constants, not library defaults
- [ ] No synchronous filesystem call on a request path
- [ ] Every non-health endpoint requires caller authentication and has a rate limit
- [ ] No credential travels in a URL, path, or query string
- [ ] CORS restricted to an explicit allowlist
- [ ] Telegram failures mapped to explicit HTTP statuses, no raw MTProto errors returned
- [ ] External calls have a timeout; no unbounded parallelism against one account
- [ ] Changed functionality is covered by tests (`.claude/rules/testing.md`)
- [ ] No real credential in any test fixture or committed artifact

## Output

- Findings grouped by severity (CRITICAL > HIGH > MEDIUM > LOW) with file paths
- Refactors applied (or proposed) and residual risks
- Validation commands and lint/build/test results

## Related Rules

- `.claude/rules/api-security.md` — perimeter checklist
- `.claude/rules/runtime-resources.md` — resource, cost and environment checklist
- `.claude/rules/drift-audit.md` — docs-versus-code consistency
- `.claude/rules/implementation-plans.md` — where this audit runs in the lifecycle
- `.claude/rules/patterns.md` — code patterns and maintainability rules
- `.claude/rules/architecture.md` — module boundaries
- `.claude/rules/telegram.md` — secret hygiene and client lifecycle
- `.claude/rules/post-code-workflow.md` — required checks after fixes
