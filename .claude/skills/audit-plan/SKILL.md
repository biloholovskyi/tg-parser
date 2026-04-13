---
name: audit-plan
description: Audit an implementation plan for completeness, risks, and plan-to-code drift (pre- or post-implementation)
model: inherit
context: fork
---

# /audit-plan

Audit an implementation plan for gaps, risks, and implementation drift.

## Instructions

- If plan path is missing, ask for it first. Plans live at `docs/plans/<name>/<name>-implementation-plan.md`.
- Load `@ai/rules/common/skills/plan-audit.md` and follow its process.
- Auto-detect audit type: if all phases are marked `done`, run post-implementation audit; otherwise run pre-implementation audit.
- Use Grep/Glob tools to verify claims in evidence notes and check for stale references.
- Report findings grouped by severity (CRITICAL > HIGH > MEDIUM > LOW) with file paths and recommended actions.
