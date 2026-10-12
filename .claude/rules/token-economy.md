---
paths:
  - ".claude/rules/**/*"
  - "CLAUDE.md"
---
# Token Economy

Optimize AI context: load only what is needed, when it is needed.

## Core Rules

- Zero code examples in rules: AI generates code
- Task-based loading: load files for the specific task only
- Single source: cross-link, do not duplicate
- Tables over prose in rule files (decision matrices)
- Tables in AI responses: use lists (no markdown tables); rule files may use tables
- One rule per bullet: no pipe-separated strings
- Constants by name: reference, do not inline

## File Loading

Always loaded by the harness (no extra read):
- `CLAUDE.md` — carries the single canonical task-to-rule map

Load by task: use the "Load Rules by Task" table in `CLAUDE.md`. That table is the single source
of truth — it is deliberately not repeated here, in `.claude/rules/core-rules.md`, or in
`.claude/rules/index.md`. Load the listed file plus `.claude/rules/response-rules.md`, nothing else.

## Rule File Structure

Standard order:
1. Mission (1 sentence)
2. Constants (numeric values)
3. Decision Matrix (table)
4. Requirements (bullets)
5. Anti-Patterns (explicit list)

Format Rules:
- Target <250 lines per file
- Zero code examples (type defs in backticks OK)
- Reference constants by name
- No bold formatting for emphasis
- Keep it actionable

## Anti-Patterns

- Code examples in rules
- Pipe-separated strings
- Inline numeric values without constants
- Multiple files covering the same topic
- Loading all files instead of task-based
- Duplicate sections across files

## Metrics

Targets:
- Rule files: <250 lines
- Planning phase: <500 tokens
- Per-task load: <2,500 tokens (multi-rule skills like implementation-plans may exceed; load only when the phase requires them)
