---
name: implement-plan-step
description: Execute a single phase of an implementation plan with quality gates and a user checkpoint
---

# /implement-plan-step

## Instructions

Execute ONE phase of an existing plan at a time. Do NOT batch phases unless the plan explicitly marks them as fully parallel.

1. Locate the plan: `docs/plans/<slug>/<slug>-implementation-plan.md`.
2. Identify the next `todo` or `in_progress` phase.
3. Load ONLY the plan index, the active phase file, and the rule files listed in that phase's Required Rules section.
4. Record the phase start: append `- phase-XX start <ISO8601>` to `docs/plans/<slug>/history.md`.
5. Execute the phase scope and checklist per `.claude/rules/plan-execution.md`. Target-state only: build what the phase describes, not a migration diff.
6. Self-audit: re-read the scope, run ONLY the verification commands listed in the active phase file, compare the output to the acceptance criteria.
   - Run nothing that belongs to a later phase. No E2E suite, no refactor/security audit, no version or CHANGELOG sync, no git operation, unless that exact command is listed in THIS phase's verification commands.
7. If verification fails, loop back to step 5 with fixes. Do not claim the phase is done with failing verification.
8. Record the phase end and update the plan files:
   - `history.md`: append `- phase-XX end <ISO8601>`, then the handoff note for the next phase (max 7 bullets).
   - Phase file: mark status `done`, add an evidence note (1-7 bullets).
   - Index file: update the status row.
9. HARD STOP at the user gate. Present results, then stop and wait for explicit user approval before doing anything further. One skill invocation equals one phase. Do not start the next phase and do not begin Finalize work — even a general instruction like "execute the plan" does NOT authorize crossing this gate.

## Quality Gates

- Feature phases ship with tests; delegate test authoring to the `test-writer` agent (`.claude/rules/testing.md`).
- Post-code phases run the full `/post-code` flow.
- Audit phases run the `.claude/rules/refactor-security-audit.md` checklist.
- Phases touching `src/telegram/` verify against `.claude/rules/telegram.md`: no secret logging, every client disconnected, errors mapped to explicit HTTP statuses.
- Closeout runs in a single Finalize phase, not one gate per item.
- For `standard`-tier plans the Report closeout runs `/plan-report`; the plan is not `done` until the report file and its index row exist. `small` and bugfix plans skip the report.
- Never run `git commit` (`.claude/rules/git-conventions.md`).

## Arguments

- `$ARGUMENTS` — optional phase id or file path. If omitted, pick the next non-done phase.
