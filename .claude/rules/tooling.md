---
paths:
  - "CLAUDE.md"
  - ".claude/**/*"
  - "package.json"
---
# Tooling

Mission: define shell behavior, package scripts, and the Claude-native configuration layout for `tg-parser`.

## Constants

- RULES_ROOT = `.claude/rules/`
- PACKAGE_MANAGER = `npm`
- LOCKFILE = `package-lock.json`
- SHELL = `PowerShell`
- SHELL_PREFIX = `rtk`

## Claude Layout

`.claude/` is canonical and hand-edited. Rule content lives directly under `.claude/rules/` (there is no separate `ai/` folder):

- Rules: `.claude/rules/*.md` — full content, with `paths:` frontmatter for path-gated auto-load
- Agents: `.claude/agents/*.md`
- Skills: `.claude/skills/<name>/SKILL.md`
- Agent memory: `.claude/agent-memory/<agent>/MEMORY.md` — scope and format in `.claude/agent-memory/README.md`
- Settings: `.claude/settings.json` (project, committed — permission allowlist for `rtk` commands)
- Settings, local: `.claude/settings.local.json` (machine-specific overrides and reminders)
- Hooks: `.claude/hooks/*.js` — committed guards wired from `.claude/settings.json`; a guard that blocks exits non-zero
- MCP servers: `.mcp.json` — `context7` (library docs; used for GramJS and NestJS API lookups)
- Entry point: `CLAUDE.md` (root) → `.claude/rules/*.md` → `.claude/rules/index.md`

Repository artifact folders referenced by the rules:

- `docs/plans/{component}/` — implementation plans
- `docs/testing/` — manual test artifacts and Postman collections
- `docs/reviews/` — `code-reviewer` reports
- `docs/reports/` — plan Finalize reports (`docs/reports/README.md` is the index)
- `CHANGELOG.md` — version log

## Requirements

- Use PACKAGE_MANAGER for project scripts; this project has no pnpm lockfile.
- Prefix shell commands with SHELL_PREFIX (`rtk`).
- Prefer `rtk npm run <script>` for package scripts.
- Prefer `rtk rg --files` for file discovery.
- Prefer `rtk read <file>` for targeted file reads.
- Use PowerShell-native commands when shell features are required on Windows.
- Keep machine-specific reminders in `.claude/settings.local.json`; project guards that must apply to everyone live in `.claude/hooks/` and are wired from `.claude/settings.json`.

## Command Reference

- `rtk npm run start:dev` — dev server with watch mode
- `rtk npm run build` — compile TypeScript to `dist/`
- `rtk npm run start:prod` — run compiled output
- `rtk npm run lint` — ESLint with auto-fix
- `rtk npm run format` — Prettier
- `rtk npm run typecheck` — type-only check (`tsc --noEmit`)
- `rtk npm test` — Jest unit tests
- `rtk npm run test:cov` — unit tests with coverage
- `rtk npm run test:e2e` — E2E suite (`test/jest-e2e.json`)

## Anti-Patterns

- Using unprefixed package-manager commands in assistant-facing docs.
- Using `pnpm` or `yarn` in this project (npm plus `package-lock.json` only).
- Running Unix-only shell aliases on Windows when PowerShell-native commands are needed.
- Reintroducing an `ai/` rules folder; rule content stays under `.claude/rules/`.
