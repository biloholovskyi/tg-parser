---
paths:
  - "docs/plans/**/*"
  - ".claude/rules/implementation-plans.md"
---
# Implementation Plans

Mission: structure plans as target-state-only file artifacts; enforce plan-then-implement with user gates and self-audit at every stage.

## Constants

- PLAN_MAX_LINES = 250
- PLAN_STATUS_VALUES = todo | in_progress | done | deferred
- PLAN_MAX_NEXT_ACTIONS = 5
- PLAN_INDEX_NAMING = `{component}-implementation-plan.md`
- PLAN_PHASE_FILE_NAMING = `phase-XX-{slug}.md`
- PLAN_FOLDER_LAYOUT = `docs/plans/{component}/`
- PLAN_SIMPLE_MAX_PHASES = 4
- PLAN_ACTIVE_PHASE_LIMIT = 1 (2 when fully parallel, no shared files or state)
- PLAN_FLOW = Research > Design > Plan > Implement > Finalize
- PLAN_TASK_PROFILES = feature | bugfix | hybrid
- PLAN_COMPLEXITY_TIERS = small | standard

Artifact names (folder layout):
- `research.md`, `design.md` (C4/DFD/sequence when complex), `risks.md` (see HIGH_RISK_SURFACE), `adr-{slug}.md` (optional), `history.md`, `reflect.md`

High-risk surface, triggering the risk artifact:
- HIGH_RISK_SURFACE = auth flow, session cache, GramJS client lifecycle, secret handling, the public REST perimeter, any change to what the service persists

Manual test artifacts (created when REST endpoints or request/response contracts are added or changed):
- TESTING_ARTIFACTS_DIR = `docs/testing/`
- TESTING_ARTIFACTS_MD = `{component}-manual-testing.md`
- TESTING_ARTIFACTS_POSTMAN = `{component}-postman-collection.json`

## Plan Content Rules

- Language: write all plan artifacts in Russian (index, phase files, `research.md`, `design.md`, `history.md`, `reflect.md`, ADRs). Code identifiers, paths, commands, and rule references stay in their original form.
- Target-state only: describe how it should be, not how it is now
- No before/after comparisons, no migration diffs, no "current state" sections
- No code examples (type defs in backticks OK, reference paths instead)
- `research.md`: facts-only discovery — affected files, boundaries, constraints, open questions
- Phase files: describe the end state the model should build
- When existing code is far from target, note "write from scratch" as an implementation hint
- Tables over prose for decision matrices and field mappings
- Each file < PLAN_MAX_LINES

## Lifecycle

Two-stage: Plan (generate, audit, approve) then Execute (implement phases one at a time).

Phase vs closeout:
- Phase = a unit of work that ends in a user gate.
- Closeout checklist = mechanical completion steps executed inside a single final Finalize phase — one gate, not one gate per step.

Plans follow PLAN_FLOW, scaled by complexity tier:
- Research: facts-only artifact, no solutioning (brief or inline for `small`)
- Design: diagrams (C4 / DFD / sequence) when complex; ADR for high-risk decisions (skip for `small` unless a real design fork exists)
- Risk, inside Design and not a separate gate: required whenever the change touches HIGH_RISK_SURFACE, in either tier. Produces `risks.md` — failure modes, blast radius, what it costs if it runs wrong in production for a week, secret exposure, and the rollback move. Design is not complete without it.
- Plan: executable phase files with verification and acceptance
- Implement: feature phase(s) one at a time with quality gates; tests live inside the feature phase
- Finalize: single gated phase running the closeout checklist

No implementation code until the plan is written to files and user-approved.

## Task Profile Classifier

| Signal | Criteria | Threshold |
|--------|----------|-----------|
| Feature | New capability or endpoint, contract changes, multi-module, architecture trade-offs | >= 2 signals -> `feature` |
| Bugfix | Deterministic repro, minimal corrective change, no contract expansion | >= 2 signals -> `bugfix` |
| Mixed | Both above thresholds met | -> `hybrid` |

Record `profile`, signal counts, and rationale in the plan index.

## Complexity Tier

Assess the tier before writing phases; record `tier` plus rationale in the plan index alongside `profile`.

| Tier | Signals (2+ → the tier) | Lifecycle |
|------|--------------------------|-----------|
| `small` | bugfix profile; single module; no change to the session model; no breaking contract change; small diff (~5 files or fewer) | Feature phase (tests inside) + Finalize checklist. No separate test/audit/artifacts/reflect/report gates. No completion report. |
| `standard` | feature profile; multi-module; change to the session/auth model or the GramJS client lifecycle; breaking or wide contract change; multiple new endpoints | Full PLAN_FLOW. Finalize includes reflect + completion report. Separate test phase only when test volume is large. |

Tier rules:
- `bugfix` profile defaults to `small` unless a standard signal forces it up.
- `small` skips the completion report and the `reflect.md` artifact; capture any lesson or tech debt as one line in `history.md` or the CHANGELOG bullet instead.
- `small` does not skip `risks.md` when the change touches HIGH_RISK_SURFACE; a one-page risk note is the minimum.
- Anything touching HIGH_RISK_SURFACE is `standard` unless the user explicitly downgrades it.
- Report, reflect, audit, and version-sync are never separate gated phases — they are Finalize checklist items scaled by tier.
- Escalate a `small` plan to `standard` if scope grows during implementation, then add the skipped closeout items.
- When unsure, pick `standard`.

## Plan Structure

Index file (PLAN_INDEX_NAMING):
- Mission (1-2 bullets)
- Task profile
- Complexity tier (`small` or `standard`) plus rationale
- High-risk surface touched: yes or no, with a link to `risks.md` when yes
- Target version (`X.Y.Z`, confirmed with the user before planning — see `.claude/rules/versioning-changelog.md`)
- Phase list: `Phase X (status) - description [link]`
- Next actions (up to PLAN_MAX_NEXT_ACTIONS)

Phase files (PLAN_PHASE_FILE_NAMING):
- Status, required rules
- Goal (1 sentence)
- Implementation notes (write-from-scratch hints, patch hints)
- Scope (what to build — target state only)
- Checklist
- Verification commands
- Acceptance criteria

Complexity check — use the folder layout when:
- The index would exceed PLAN_MAX_LINES
- Phase count > PLAN_SIMPLE_MAX_PHASES
- Work spans multiple modules

## Plan Generation

Step 0: Resolve clarifying questions
- Ask all blocking clarifying questions (scope, design forks, target version) up front
- Do NOT present the design or plan inline in chat for approval first
- Once every blocking question is answered, proceed directly to Step 1

Step 1: Write the plan to files
- Exploration step first: search the codebase, validate assumptions
- Confirm research and design artifacts exist and are linked
- Create the index plus phase files immediately after clarifications are resolved

Step 2: Self-audit
- All required lifecycle phases present
- Each phase has scope, verification, acceptance
- Total plan within token-economy limits
- Target-state-only language verified (no comparison language)

Step 3: User gate (read-the-files gate)
- After the files are written, tell the user the plan is in `docs/plans/<component>/` and list the artifact paths
- Wait for the user to read the files and request corrections; apply requested edits, re-run Step 2, and wait again
- Do not start implementation until the user approves the written plan

## Required Work

For plans with code changes. Scale by complexity tier.

Pre-code (both tiers, scaled): Research > Design > Plan. For `small`, Research and Design may be brief and inline in the index; a separate `design.md` is only needed when there is a real design fork.

Implement:
- Feature phase(s) — build the target state. Tests ship inside the feature phase (`.claude/rules/testing.md`); add a separate test phase ONLY when test volume is large.
- No feature phase ships untested functionality.
- Move high-risk feature phases earlier to fail fast. For this project, anything touching the session cache or the auth flow is high-risk.

Finalize — a single gated phase running the closeout checklist:
1. Post-code workflow (`.claude/rules/post-code-workflow.md`) — lint/build/test green
2. Refactor and security audit (`.claude/rules/refactor-security-audit.md`); rerun post-code checks after fixes
3. Smoke run — boot the service and exercise the changed path for real. Green unit tests are not evidence that the service starts. Required whenever `src/` changed.
4. Drift check (`.claude/rules/drift-audit.md`) — the rules and `CLAUDE.md` still describe what the code does
5. API test artifacts (`docs/testing/*`) — only when REST endpoints or contracts were added or changed (`.claude/rules/api-contracts.md`)
6. Docs sync (when API, config, or workflow changed)
7. Changelog and version-sync (`.claude/rules/versioning-changelog.md`)
8. `standard` only: Reflect (lessons, design alignment, tech debt) plus the completion report (`.claude/rules/report-generation.md`)
9. Commit-prep (`.claude/rules/git-conventions.md`) — preparation only; never add a `git commit` step to a plan

- No closeout step is its own gated phase.
- `standard` plans are not `done` until the report exists and the index links it; `small` plans have no report or reflect gate.

### Finalize: Changelog and Version-Sync

Before planning starts, ask the user for the target version (`X.Y.Z`) and record it in the plan index. As a Finalize checklist item, run the three consistency gates in `.claude/rules/versioning-changelog.md`:

- Branch matches `r-{version}` (propose creating or switching only on explicit approval)
- `package.json` `version` equals the target version
- `CHANGELOG.md` has a `[version] DD.MM.YYYY` header with today's date and the completed work as the top bullet

This prepares the commit; it does not commit.

### Finalize: API Test Artifacts

Required in both tiers whenever a plan adds or changes REST endpoints, or changes a request/response contract. Produce the artifacts described in `.claude/rules/api-contracts.md` in TESTING_ARTIFACTS_DIR.

### Finalize: Report (`standard` only)

`standard`-tier plans generate the plan-completion report and update the reports index per `.claude/rules/report-generation.md`. `small` and bugfix plans skip this entirely.

- Hard gate (`standard` only): the plan is not `done` until the report file exists AND an index row links to it.
- Does not commit.

## Anti-Patterns

- Implement before the plan is written to files and user-approved
- Skip Research or Design for standard-tier work (brief or inline is fine for `small`)
- Write code during Research, Design, or Plan phases
- Implement multiple phases in one cycle
- Skip the user gate even when asked to "implement the whole plan"
- Mark a phase done without verification evidence
- Mark a feature phase done without its tests
- Load all phase files — only the index plus the active phase
- Comparison language (before/after, current vs target) in plan files
- Embed code snippets; reference file paths instead
- Persist state only in conversation; write it to plan files
- Gate on an inline plan or design presentation in chat instead of writing the plan to `docs/plans/` first
- Plan without a confirmed target version, or without a changelog/version-sync closeout item
- Spinning a closeout step into its own gated phase instead of one Finalize phase
- Running a `small` or bugfix change through full `standard` ceremony
- Marking a `standard` plan `done` without a generated report and an updated index row
- A separate test phase for a `small` change instead of tests inside the feature phase
- Adding or changing REST endpoints without the API test-artifacts closeout item
- Touching HIGH_RISK_SURFACE without `risks.md` and a stated rollback move
- Closing a plan that changed `src/` without a smoke run, on the strength of green unit tests
- Closing a plan without checking that the rules still match the code
- Add a `git commit` step to a plan

## Cross-References

- `.claude/rules/core-rules.md` — entry point, task routing
- `.claude/rules/plan-execution.md` — executing a phase
- `.claude/rules/token-economy.md` — file loading, token budget
- `.claude/rules/post-code-workflow.md` — quality checks
- `.claude/rules/testing.md` — mandatory test coverage
- `.claude/rules/plan-audit.md` — audit checklist
- `.claude/rules/refactor-security-audit.md` — audit checklist for the hardening step
- `.claude/rules/versioning-changelog.md` — version/branch/changelog consistency
- `.claude/rules/report-generation.md` — Report closeout item (`standard` tier only)
- `.claude/rules/drift-audit.md` — drift closeout item
- `.claude/rules/api-security.md` — perimeter constraints that shape high-risk design
- `.claude/rules/runtime-resources.md` — resource and cost constraints that shape high-risk design
