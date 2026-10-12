---
name: start-task
description: Classify a user task and initialize an implementation plan when needed
---

# /start-task

## Instructions

1. Read the user brief.
2. Ask the user for the target version (`X.Y.Z`) per `.claude/rules/versioning-changelog.md` before planning. Record it for the plan index.
3. Classify the task profile per `.claude/rules/implementation-plans.md`:
   - `feature` — new capability, contract change, multi-module
   - `bugfix` — deterministic repro, minimal corrective change
   - `hybrid` — both feature and bugfix signals
4. Assess the complexity tier (`small` or `standard`). Anything touching the session cache, the auth flow, or the GramJS client lifecycle is `standard` by default.
5. Estimate atomic steps. If 3 or more steps, or the task spans multiple modules, or it has non-trivial architecture trade-offs, a plan is required.
6. If no plan is needed (a simple 1-2 step task):
   - List assumptions.
   - Load only the rule files the "Load Rules by Task" table in `CLAUDE.md` names for this task.
   - Proceed.
7. If a plan is needed:
   - Create `docs/plans/<slug>/`.
   - Create `docs/plans/<slug>/<slug>-implementation-plan.md` (index) with Mission, task profile with signal counts, complexity tier with rationale, target version, phase list, rule coverage, and next actions.
   - Create per-phase files `phase-XX-<slug>.md` with Goal, Scope, Checklist, Verification Commands, Acceptance Criteria.
   - Create `research.md` with facts-only discovery.
   - Write all plan artifacts in Russian; keep identifiers, paths, and commands as-is.
   - Self-audit the plan using `.claude/rules/plan-audit.md`.
   - Tell the user the plan files are written and list their paths; do NOT start coding until the user approves.

## Arguments

- `$ARGUMENTS` — the task brief from the user.
