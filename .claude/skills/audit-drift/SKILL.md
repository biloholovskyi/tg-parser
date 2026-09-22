---
name: audit-drift
description: Verify that CLAUDE.md and the rules still describe what the code does, via the docs-drift-auditor agent
---

# /audit-drift

## Instructions

Delegate to the `docs-drift-auditor` agent (`.claude/agents/docs-drift-auditor.md`). The canonical process is `.claude/rules/drift-audit.md`.

1. Determine the scope from `$ARGUMENTS`. If omitted, check every claim source: `CLAUDE.md`, `.claude/rules/*.md`, `README.md`, `railway.toml`, `package.json`.
2. Launch the agent. Every claim is verified against code, never against another document.
3. Each finding is classified before anything is edited: doc wrong, code wrong, or open decision.
4. Apply only the documentation fixes for findings where the doc is wrong and the code is right, and only when the user asked for fixes to be applied in this run.
5. A finding where the code violates a rule is reported as a code defect and scheduled. Never relax a rule to match the code.
6. An open decision is escalated to the user with the fork stated. Do not edit either side.

## Output

- Findings: claim, source, contradicting code, classification, proposed action
- Documentation edits applied, if any
- Open decisions requiring a user call
- An explicit statement when nothing has drifted

## Arguments

- `$ARGUMENTS` — a rule file, a doc, or a subject area. If omitted, check everything.
