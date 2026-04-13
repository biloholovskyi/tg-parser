---
name: implement-plan-step
description: Execute implementation plans one phase at a time with strict status tracking and mandatory user approval between phases.
model: inherit
---

# /implement-plan-step

Execute one approved implementation-plan phase at a time, then pause for user review before continuing.

## Instructions

- If plan index path is missing, ask for it first. Default shape: `docs/plans/<name>/<name>-implementation-plan.md`.
- Load `@ai/rules/common/implementation-plans.md` and follow the Phase Execution Loop.
- Confirm the plan is user-approved before starting any implementation phase. If not approved, stop and request approval.
- Select the active phase:
  - If user requested a specific phase, use it.
  - Otherwise choose the first `Phase XX (todo)` after the latest `done` in the index file.
- Before implementation, mark active state:
  - Index: `Phase XX (in_progress) - ...`
  - Phase file: `Status: in_progress`
- Implement only the active phase scope and checklist. Do not execute multiple phases in one run.
- Run all verification commands from the phase file and capture concise output evidence.
- If any check fails or checklist item remains incomplete:
  - Keep the phase status as `in_progress`.
  - Report blockers and exact next fixes.
  - Stop and wait for user direction.
- If acceptance criteria are satisfied:
  - Mark completed checklist items as `[x]`.
  - Update phase `Evidence` and `Handoff` sections.
  - Set phase file `Status: done`.
  - Update index line to `Phase XX (done) - ...`.
- Present a phase review handoff:
  - What changed
  - Verification evidence
  - Remaining risks/open questions
  - Suggested next phase
- Ask explicitly for gate approval: `Approve Phase XX and continue to the next phase?`
- Do not start the next phase until explicit user approval is received, even when user asks to implement the whole plan.
