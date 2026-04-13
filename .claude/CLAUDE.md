# Claude Code Entry

Project: tg-parser (NestJS + GramJS). Load rules by task, not all at once.
SSoT for all rules: `ai/rules/` | Task loading table: below.

## Core Rules

Load `ai/rules/common/core-rules.md` for the task-to-file mapping.

## Key Rules by Task

- Phase planning: `ai/rules/common/implementation-plans.md`
- TypeScript/patterns: `ai/rules/common/patterns.md`
- Post-code QA: `ai/rules/common/post-code-workflow.md`
- Security/refactor audit: `ai/rules/common/skills/refactor-security-audit.md`
- Plan audit: `ai/rules/common/skills/plan-audit.md`

## Skills

`.claude/skills/`: `/post-code`, `/audit-security`, `/audit-plan`, `/implement-plan-step`

## Hooks

PostToolUse and Stop hooks in `.claude/settings.local.json` remind about `/post-code` before committing.
