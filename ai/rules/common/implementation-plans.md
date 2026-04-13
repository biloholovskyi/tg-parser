# Implementation Plans (AI Optimized)

Mission: structure plans as target-state-only file artifacts; enforce plan-then-implement with user gates and self-audit at every stage.

## Constants

- PLAN_MAX_LINES = 250
- PLAN_STATUS_VALUES = todo | in_progress | done | deferred
- PLAN_MAX_NEXT_ACTIONS = 5
- PLAN_INDEX_NAMING = {component}-implementation-plan.md
- PLAN_PHASE_FILE_NAMING = phase-XX-{slug}.md
- PLAN_FOLDER_LAYOUT = docs/plans/{component}/
- PLAN_SIMPLE_MAX_PHASES = 4
- PLAN_ACTIVE_PHASE_LIMIT = 1 (2 when parallel, no shared files/state)
- PLAN_AUDIT_MIN_RECHECKS = lint | format | build
- PLAN_FIVE_PHASE_FLOW = Research > Design > Plan > Implement > Reflect
- PLAN_DESIGN_DIAGRAM_SET = C4(Context|Container|Component) + DFD + Sequence
- PLAN_TASK_PROFILES = feature | bugfix | hybrid

Artifact names (folder layout):
- research.md, design-c4.md, design-dfd.md, design-sequence.md, adr-{slug}.md (optional)

## Plan Content Rules

- Target-state only: describe how it should be, not how it is now
- No before/after comparisons, no migration diffs, no "current state" sections
- No code examples (type defs in backticks OK, reference paths instead)
- research.md: facts-only discovery — affected files, boundaries, constraints, open questions
- Design and phase files: describe the end state the model should build
- When existing code is far from target, note "write from scratch" as implementation hint
- The model should verify existing code and decide: patch if close to target, rewrite if not
- Tables over prose for decision matrices and field mappings
- Each file < PLAN_MAX_LINES

## Documentation SoT

- Architecture source of truth: `CLAUDE.md` (root)
- Plans: `docs/plans/{component}/`

## Lifecycle

Two-stage: Plan (generate, audit, approve) then Execute (implement phases one at a time).

Multi-phase tasks follow PLAN_FIVE_PHASE_FLOW:
- Research: facts-only artifact, no solutioning
- Design: C4 + DFD + Sequence diagrams (ADR for high-risk decisions)
- Plan: executable phase files with model tier, verification, acceptance
- Implement: one phase at a time with quality gates
- Reflect: lessons learned, design alignment check, tech debt capture

No implementation code until plan is written to files and user-approved.

## Task Profile Classifier

| Signal Type | Criteria | Threshold |
|------------|---------|-----------|
| Feature | New capability/endpoint/schema, contract changes, multi-context, architecture trade-offs | >= 2 signals -> `feature` |
| Bugfix | Deterministic repro, minimal corrective change, no contract expansion | >= 2 signals -> `bugfix` |
| Mixed | Both above thresholds met | -> `hybrid` |

Record `profile`, signal counts, and rationale in plan index.

## Plan Structure

Index file (PLAN_INDEX_NAMING):
- Mission (1-2 bullets)
- Task profile
- Phase list: `Phase X (status) - description [link]`
- Model schedule (group phases by tier)
- Next actions (up to PLAN_MAX_NEXT_ACTIONS)

Phase files (PLAN_PHASE_FILE_NAMING):
- Status, model tier, required rules
- Goal (1 sentence)
- Implementation notes (write from scratch hints, patch hints)
- Scope (what to build — target state only)
- Checklist
- Verification commands

Complexity check — use folder layout when:
- Index would exceed PLAN_MAX_LINES
- Phase count > PLAN_SIMPLE_MAX_PHASES
- Work spans multiple modules

## Plan Generation

Step 1: Write plan to files
- Exploration step first: search codebase, validate assumptions
- Confirm research and design artifacts exist and are linked
- Create index + phase files

Step 2: Self-audit
- All required lifecycle phases present
- Each phase has scope, model tier, verification, acceptance
- Total plan within token-economy limits
- Target-state-only language verified (no comparison language)

Step 3: User gate
- Present plan for review, do not start implementation until approved

## Phase Execution Loop

For each phase (no step skipped):

1. Implement: execute scope and checklist, load only index + active phase + required rules
2. Self-audit: re-read scope, run verification commands, compare against acceptance criteria
3. Update history: handoff note (max 7 bullets) in history.md with date
4. Mark done: update status in index with evidence note, checkpoint at boundary
5. User gate: present results, wait for approval before next phase

## Model Protocol

| Phase Type | Default Tier |
|-----------|-------------|
| Exploration, docs sync | FAST |
| Feature implementation, test writing | BALANCED |
| Audit, hardening, architecture | DEEP |

- Include model tier and rationale in each phase file
- After approval, group consecutive same-tier phases into model schedule
- Escalate only when blocked; record reason before switching

## Required Lifecycle Phases

For multi-phase plans with code changes:

Pre-code: Research > Design > Plan

Implement macro-phase (recommended order):
- Feature phases
- Test phase (when test runner is present)
- Post-code workflow (`ai/rules/common/post-code-workflow.md`)
- Audit and hardening (`ai/rules/common/skills/refactor-security-audit.md`)
- Docs sync (when API/config/workflow changed)

Post-code: Reflect

- Audit phase must rerun post-code checks after fixes
- Move high-risk phases earlier to fail fast

## Anti-Patterns

- Do not implement before plan is written to files and user-approved
- Do not skip Research or Design for multi-phase work
- Do not write code during Research, Design, or Plan phases
- Do not implement multiple phases in one cycle
- Do not skip user gate even when asked to "implement the whole plan"
- Do not mark phase done without verification evidence
- Do not load all phase files — only index + active phase
- Do not add comparison language (before/after, current vs target) to plan files
- Do not embed code snippets; reference file paths
- Do not persist state only in conversation; write to plan files

## Cross-References

- `ai/rules/common/core-rules.md` — entry point, task routing
- `ai/rules/common/patterns.md` — code patterns
- `ai/rules/common/post-code-workflow.md` — quality checks
- `ai/rules/common/skills/refactor-security-audit.md` — audit checklist
- `ai/rules/common/skills/plan-audit.md` — plan audit checklist
