---
paths:
  - "docs/plans/**/*"
  - ".claude/rules/implementation-plans.md"
---
# Plan Execution

How to execute a phase of an implementation plan written per `.claude/rules/implementation-plans.md`.

## Phase Execution Loop

For each phase, with no step skipped:

1. Implement: execute the scope and checklist; load only the index, the active phase, and the rules that phase requires
2. Self-audit: re-read the scope, run only that phase's verification commands, compare the output against the acceptance criteria
3. Update history: append a handoff note (max 7 bullets) to `history.md` with the date
4. Mark done: update the status in the index with an evidence note
5. User gate: present results, then stop and wait for approval before the next phase

One skill invocation equals one phase. A general instruction such as "execute the plan" does not authorize crossing a gate.

## Scope Discipline

- Run nothing that belongs to a later phase: no E2E suite, no refactor/security audit, no version or CHANGELOG sync, no git operation, unless that exact command is listed in this phase's verification commands.
- Do not "just quickly investigate" work from the next phase while waiting at a gate.
- If verification fails, loop back to implementation with fixes. Never claim a phase is done with failing verification.

## Required Work

Pre-code (both tiers, scaled): Research > Design > Plan. For `small`, Research and Design may be brief and inline in the index.

Implement:
- Feature phase(s) build the target state. Tests ship inside the feature phase (`.claude/rules/testing.md`).
- No feature phase ships untested functionality.
- Phases touching the session cache, the auth flow, the GramJS client lifecycle, secret handling, or the REST perimeter run early — they are HIGH_RISK_SURFACE and require `risks.md` from the Design stage.

Finalize — a single gated phase running the closeout checklist:

1. Post-code workflow (`.claude/rules/post-code-workflow.md`) — lint/build/test green
2. Refactor and security audit (`.claude/rules/refactor-security-audit.md`); rerun post-code checks after fixes
3. Smoke run — boot the service and exercise the changed path; required whenever `src/` changed
4. Drift check (`.claude/rules/drift-audit.md`)
5. API test artifacts when endpoints or contracts changed (`.claude/rules/api-contracts.md`)
6. Docs sync (when API, config, or workflow changed)
7. Changelog and version-sync (`.claude/rules/versioning-changelog.md`)
8. `standard` only: reflect plus the completion report (`.claude/rules/report-generation.md`)
9. Commit-prep (`.claude/rules/git-conventions.md`) — preparation only; never a `git commit` step

No closeout step is its own gated phase.

## Quality Gates per Phase Type

- Feature phases ship with tests; delegate test authoring to the `test-writer` agent
- Post-code phases run the full `/post-code` flow
- Audit phases run the `.claude/rules/refactor-security-audit.md` checklist
- Phases touching the Telegram surface verify against `.claude/rules/telegram.md` (no secret logging, client lifecycle closed, errors mapped)
- Phases touching the session cache or any long-lived resource verify against `.claude/rules/runtime-resources.md` (ceiling, TTL, eviction disconnects, timers cleared)
- Phases touching an endpoint verify against `.claude/rules/api-security.md` (caller auth, rate limit, credential transport)

## Anti-Patterns

- Implement before the plan is written to files and user-approved
- Implement multiple phases in one cycle
- Skip the user gate even when asked to implement the whole plan
- Mark a phase done without verification evidence
- Mark a feature phase done without its tests
- Load all phase files — only the index plus the active phase
- Run a later phase's verification commands early
- Persist state only in conversation; write it to plan files
- Add a `git commit` step to a plan

## Cross-References

- `.claude/rules/implementation-plans.md` — plan structure and lifecycle
- `.claude/rules/post-code-workflow.md` — quality checks
- `.claude/rules/testing.md` — mandatory test coverage
- `.claude/rules/plan-audit.md` — audit checklist
- `.claude/rules/report-generation.md` — completion report gate
