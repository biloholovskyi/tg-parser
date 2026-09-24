---
paths:
  - "CLAUDE.md"
  - "src/**/*"
---
# Core Rules (AI Entry Point)

Entry point for AI coding assistance on `tg-parser`. Load rules by task, not all at once.

Project: NestJS 10 backend wrapping GramJS (Telegram MTProto client) to parse public and private Telegram channels through a personal user account. REST API, no database, no ORM. Sessions are cached in process memory only.

## Response Rules

See `.claude/rules/response-rules.md`. Highlights:

- No emojis, no summaries, no markdown tables in responses
- `rtk` prefix for all shell commands
- Tooling and shell behavior: `.claude/rules/tooling.md`
- English for code; respond to the user in Russian always

## Rule Precedence (hard)

When two sources of instruction conflict, the higher tier wins outright. No blending, no "best of both".

1. An explicit user instruction in the current turn
2. Project hard rules — `CLAUDE.md` Hard Rules and `.claude/rules/*.md`
3. Project skills — `.claude/skills/<name>/SKILL.md`
4. Plugin and global skills — `superpowers:*`, `skill-creator`, marketplace skills, `~/.claude/CLAUDE.md`
5. Model defaults and general heuristics

Tier 4 never overrides tier 2. A plugin skill that instructs an action this project forbids is followed only up to the point of conflict; at the conflict, the project rule applies and the deviation is stated in the reply.

### Named Conflicts (already resolved — do not re-litigate)

| Topic | Winner | Loser |
|-------|--------|-------|
| Planning lifecycle, plan artifacts, phase gates | `.claude/rules/implementation-plans.md`, `.claude/rules/plan-execution.md` | `superpowers:writing-plans`, `superpowers:executing-plans`, `superpowers:subagent-driven-development` |
| Committing, branching, pushing, PRs | `.claude/rules/git-conventions.md` | any skill step that commits, merges, or pushes |
| Who authors tests, coverage policy, test layout | `.claude/rules/testing.md` | `superpowers:test-driven-development` |
| Completion checks before claiming done | `.claude/rules/post-code-workflow.md` | `superpowers:verification-before-completion` (compatible — run the project gate) |
| Response style, summaries, tables, emojis | `.claude/rules/response-rules.md` | plugin output conventions |
| Design spec location and content | `.claude/rules/implementation-plans.md` (`design.md` inside `docs/plans/{component}/`) | `superpowers:brainstorming` (`docs/superpowers/specs/`) |
| Rule loading and context budget | `.claude/rules/token-economy.md` | any skill instructing broad preloading |

Where a plugin skill is genuinely useful, use it as a technique inside the project process, not as a replacement for it:

- `superpowers:brainstorming` may drive the Research stage; its output is written to `docs/plans/{component}/research.md` and the design to `docs/plans/{component}/design.md` in Russian.
- `superpowers:systematic-debugging` may drive bugfix investigation; the fix still ships with a regression test in the same change.
- `superpowers:test-driven-development` red-green loops are allowed inside a phase; substantive test authoring is still delegated to the `test-writer` agent.
- `superpowers:using-git-worktrees` requires an explicit user request, like any branch operation.

## Core Workflow

1. Multi-phase tasks: enforce `Research -> Design -> Plan -> Implement -> Finalize` (closeout — audit, artifacts, version-sync, and `standard`-tier reflect + report — runs in one Finalize gate; scale by complexity tier)
2. Plan first: write an implementation plan for 3+ step tasks
3. Planning source of truth: `.claude/rules/implementation-plans.md`; executing a phase: `.claude/rules/plan-execution.md`
4. Post-code workflow: `.claude/rules/post-code-workflow.md`
5. Tests are mandatory: every feature/bugfix ships with tests — `.claude/rules/testing.md`
6. No magic numbers: extract constants for numeric literals >1 (0, 1, -1 OK inline)
7. No auto-documentation: only when explicitly requested
8. No automatic commits: never commit on your own; commit only on an explicit user request (applies to subagents too) — `.claude/rules/git-conventions.md`
9. Git conventions + commit message policy: `.claude/rules/git-conventions.md` + `.claude/rules/commit-message-and-crosslinks.md`
10. Tooling and shell behavior: `.claude/rules/tooling.md`
11. Telegram/GramJS work has its own hard rules — `.claude/rules/telegram.md`
12. The public REST surface is privileged: caller auth, rate limits and credential transport are hard rules — `.claude/rules/api-security.md`
13. Every resource opened at runtime has a ceiling and a release path; leaks are billed — `.claude/rules/runtime-resources.md`
14. Rules and `CLAUDE.md` must keep describing the real system — `.claude/rules/drift-audit.md`

## Task → Files

All rule files live in `.claude/rules/`.

The canonical task-to-rule map is the "Load Rules by Task" table in `CLAUDE.md`, which the harness loads automatically. It is not duplicated here — read it there and load only the file(s) it names, plus `.claude/rules/response-rules.md`.

## Quick Reference

Naming:

- Classes: PascalCase
- Functions/Variables: camelCase
- Files: kebab-case
- Constants: SCREAMING_SNAKE_CASE
- Boolean vars: verb prefix (`isX`, `hasX`, `canX`)

Functions:

- Max 20 lines (refactor at 30)
- Max 3 nesting depth
- Max 5 params (use RO-RO pattern)

TypeScript:

- `tsconfig.json` runs with `strictNullChecks` and `noImplicitAny` on — see `.claude/rules/typescript.md`
- No path aliases are configured; imports are relative
- New code is written as if strict: explicit types, no implicit `any`, no unchecked nullables

NestJS Module Layout (strict):

- `*.module.ts`, `*.controller.ts` (REST), `*.service.ts`
- `dto/` for request DTOs with `class-validator`
- `interfaces/` for response shapes and domain types
- `config/` for env-backed configuration loaders
- Controllers thin — delegate to the service

## OS / Shell

Windows + PowerShell. Always prefix shell commands with `rtk` (project helper). Use `rtk rg --files` for file discovery and `rtk read <file>` for targeted reads.

## Links

Core:

- `.claude/rules/index.md` — compiled task-map index
- `.claude/rules/core-rules.md` — this file (entry point)
- `.claude/rules/patterns.md` — TS/testing/error/async patterns
- `.claude/rules/implementation-plans.md` — planning lifecycle
- `.claude/rules/plan-execution.md` — executing a plan phase
- `.claude/rules/post-code-workflow.md` — QA workflow
- `.claude/rules/testing.md` — mandatory test coverage policy
- `.claude/rules/tooling.md` — tooling and shell behavior
- `.claude/rules/commit-message-and-crosslinks.md` — commit trailer and crosslink policy
- `.claude/rules/git-conventions.md` — conventional commits + branch rules
- `.claude/rules/versioning-changelog.md` — version/branch/CHANGELOG consistency gate
- `.claude/rules/report-generation.md` — plan completion report + index gate
- `.claude/rules/token-economy.md` — loading discipline

Project:

- `.claude/rules/architecture.md` — NestJS module layout and REST surface
- `.claude/rules/telegram.md` — GramJS/MTProto, sessions, secrets
- `.claude/rules/api-security.md` — perimeter auth, rate limits, credential transport
- `.claude/rules/runtime-resources.md` — resource ceilings, runtime environment, cost
- `.claude/rules/typescript.md` — TS config and decorators
- `.claude/rules/api-contracts.md` — REST contract changes and manual test artifacts

Audits:

- `.claude/rules/plan-audit.md` — plan audit checklist
- `.claude/rules/refactor-security-audit.md` — code quality and security
- `.claude/rules/test-coverage-audit.md` — test coverage gaps
- `.claude/rules/drift-audit.md` — rules and docs versus code
