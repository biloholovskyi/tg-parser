# Core Rules (AI Entry Point)

Entry point for AI coding assistance. Load rules by task, not all at once.

## Token Economy

Response Rules:
- No emojis in responses or code
- No summaries after completing tasks
- No markdown tables in AI responses (use lists); rule files may use tables
- No "would you like me to continue" - just continue or stop
- No auto-documentation unless explicitly requested
- Minimal explanations - code speaks for itself
- Reference constants by name, don't repeat values

Context Rules:
- Task-based loading: Load rule files for specific task only
- Zero code examples in rules: AI generates code
- Single source: Cross-link, don't duplicate content
- Planning phase: <500 tokens
- Per-task load: <2,500 tokens

## Core Workflow

1. Multi-phase tasks: enforce `Research -> Design -> Plan -> Implement -> Reflect`
2. Plan first: Use `todo_write` for 3+ step tasks
3. Planning source of truth: `ai/rules/common/implementation-plans.md`
4. Post-code workflow: `ai/rules/common/post-code-workflow.md`
5. No magic numbers: Constants for numeric literals >1
6. No auto-documentation: Only when explicitly requested

## Task → Files

| Task | Load |
|------|------|
| Planning | `ai/rules/common/implementation-plans.md` |
| Plan audit | `ai/rules/common/implementation-plans.md` + `ai/rules/common/skills/plan-audit.md` |
| TypeScript/Testing | `ai/rules/common/patterns.md` |
| Refactor + security audit | `ai/rules/common/skills/refactor-security-audit.md` |
| Post-Code QA | `ai/rules/common/post-code-workflow.md` |

## Quick Reference

Naming:
- Classes: PascalCase
- Functions/Variables: camelCase
- Files: kebab-case
- Constants: SCREAMING_SNAKE_CASE

Functions:
- Max 20 lines (refactor at 30)
- Max 3 nesting depth
- Max 5 params (use RO-RO pattern)

Constants:
- Location: `src/shared/constants/`
- Structure: Const objects with `as const`
- Naming: Module prefix + singular (TELEGRAM_TIMEOUT_MS)
- Usage: Destructure at call sites from const object

## OS Commands

Windows: Use forward-slash paths in bash, PowerShell available. No `sudo`.
