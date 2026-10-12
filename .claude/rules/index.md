# Rules Index — tg-parser

Compiled task map for Claude Code. Rules live under `.claude/rules/`.

## Entry Point

- `CLAUDE.md` (root) → `.claude/rules/*.md` (path-gated, full content) → this file

## Always-Load Base

- `.claude/rules/core-rules.md` — entry + rule precedence
- `.claude/rules/response-rules.md` — AI response style
- `.claude/rules/tooling.md` — shell commands, package scripts
- `.claude/rules/testing.md` — mandatory test coverage policy

## Task → Rule Files

See the "Load Rules by Task" table in `CLAUDE.md` — the single canonical map. It is not
duplicated in this index.

## Rule Files

- `.claude/rules/core-rules.md`
- `.claude/rules/response-rules.md`
- `.claude/rules/token-economy.md`
- `.claude/rules/tooling.md`
- `.claude/rules/patterns.md`
- `.claude/rules/architecture.md`
- `.claude/rules/telegram.md`
- `.claude/rules/typescript.md`
- `.claude/rules/api-contracts.md`
- `.claude/rules/api-security.md`
- `.claude/rules/runtime-resources.md`
- `.claude/rules/testing.md`
- `.claude/rules/post-code-workflow.md`
- `.claude/rules/implementation-plans.md`
- `.claude/rules/plan-execution.md`
- `.claude/rules/report-generation.md`
- `.claude/rules/git-conventions.md`
- `.claude/rules/commit-message-and-crosslinks.md`
- `.claude/rules/versioning-changelog.md`
- Audit checklists:
  - `.claude/rules/plan-audit.md`
  - `.claude/rules/refactor-security-audit.md`
  - `.claude/rules/test-coverage-audit.md`
  - `.claude/rules/drift-audit.md`

## Agents

Agent definitions: `.claude/agents/*.md`.

- `tg-parser-backend-expert` — primary NestJS/GramJS implementer
- `test-writer` — dedicated test author (Jest unit + Supertest E2E)
- `code-reviewer` — review of recently written or uncommitted code
- `codebase-researcher` — read-only codebase discovery
- `command-runner` — runs lint/build/test off the main thread
- `dependency-analyst` — dependency and version-alignment analysis
- `plan-auditor` — read-only implementation-plan audit
- `test-coverage-auditor` — Jest coverage gaps
- `parallel-tester` — parallel Jest runs
- `full-package-auditor` — package.json + quality + security + coverage
- `report-writer` — plan-completion report author
- `security-auditor` — perimeter and secret-hygiene audit
- `resource-leak-auditor` — connection, cache, timer and cost audit
- `docs-drift-auditor` — rules and docs versus code
- `debugger` — systematic root-cause investigation

Agent memory: `.claude/agent-memory/`.

## Skills / Commands

Skill definitions live in `.claude/skills/<name>/SKILL.md`.

- `post-code` — full QA (lint + build + test)
- `commit` — conventional commit flow with pre-commit gates
- `lint` — ESLint auto-fix
- `test` — Jest unit tests
- `build` — nest build
- `typecheck` — tsc --noEmit
- `start-task` — classify a task and initialize a plan when needed
- `implement-plan-step` — execute one plan phase with gates
- `write-tests` — delegate test authoring to `test-writer`
- `audit-plan` — plan audit
- `audit-security` — refactor + security audit
- `plan-report` — plan completion report + reports index (Finalize gate, `standard` tier)
- `audit-resources` — resource, leak and cost audit
- `audit-drift` — rules and docs versus code
- `debug` — systematic debugging with a mandatory regression test

## Deployment

Railway via `railway.toml` (RAILPACK builder, `npm run start:prod`, health check `/telegram/health`). Deployment is intentionally NOT governed by a Claude rule file or an MCP server in this project.

## Load Discipline

- Target rule budget per task < 2,500 tokens
- Load `.claude/rules/core-rules.md` plus task-specific files only
- For multi-phase plans: load `implementation-plans.md` during planning, unload during per-phase implementation
