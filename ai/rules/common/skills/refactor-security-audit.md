# Skill: Refactor and Security Audit (AI-driven)

Use when refactoring files for structure, constants, exported types, and security hardening.
Also serves as the canonical checklist for the "Audit and Hardening" phase in `ai/rules/common/implementation-plans.md`.

Triggers:
- User asks for refactor, cleanup, quality improvements, or file audit
- User asks to split `shared` code into constants, types, utils, or validators
- User asks to find magic numbers/strings and extract constants
- User asks for security audit during refactor
- Changes touch multiple files or introduce new patterns
- Implementation plan reaches the audit and hardening phase

Process:
- Scope target files and load `ai/rules/common/patterns.md`.
- Audit against `ai/rules/common/patterns.md` for critical maintainability issues.
- Run structure audit: mixed concerns in one file, long functions/classes, repeated literals, and high nesting.
- Extract literals: move repeated numeric/string literals to named constants with units/context.
- Replace repeated magic strings with constants or equivalent shared declarations.
- Split modules: keep runtime logic in implementation files, move exported types/interfaces to `*.types.ts`, and keep pure helpers in `utils/`.
- Enforce type-only imports/exports: use `import type` and `export type` for type-only symbols.
- Fix type issues: remove `any` where possible, add missing types, fix type narrowing.
- Reduce nesting and break large functions into smaller ones per `ai/rules/common/patterns.md` limits.
- Validate NestJS module structure: controllers handle HTTP only, services contain business logic, no cross-module direct imports (use dependency injection).
- Run security pass aligned to OWASP ASVS v5.0: validate inputs at boundaries, prevent injection patterns, avoid secret/session logging, verify dependency hygiene.
- Prefer automated guardrails where available (ESLint security rules) before manual review.
- Re-verify after all audit fixes: `npm run lint`, `npm run format`, `npm run build`.

Output:
- Findings grouped by severity with file paths.
- Refactors applied (or proposed) and residual risks.
- Validation commands and lint/build results.

Related Rules:
- `ai/rules/common/implementation-plans.md` - references this skill for the audit and hardening phase.
- `ai/rules/common/patterns.md` - code patterns and maintainability rules.
- `ai/rules/common/post-code-workflow.md` - required quality checks to run after audit fixes.
