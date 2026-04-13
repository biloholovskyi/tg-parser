# Skill: Implementation Plan Audit (AI-driven)

Use when auditing an implementation plan for completeness, risks, and implementation drift —
both before coding starts (pre-implementation) and after all phases are done (post-implementation).
Complements the planning lifecycle in `ai/rules/common/implementation-plans.md`.

Triggers:
- User asks to audit, review, or validate an implementation plan
- A plan reaches Phase 00 (exploration) and needs a pre-implementation quality gate
- All implementation phases are done and the plan needs a post-implementation completeness check
- User wants to verify plan-to-code alignment before finishing

## Pre-Implementation Audit

Run before any code is written. The plan must exist at `docs/plans/<plan-name>/<plan-name>-implementation-plan.md`.

### Plan Completeness Checklist

- [ ] Mission statement is clear and scoped (one sentence)
- [ ] Task profile is classified (feature / bugfix / hybrid) with signal counts
- [ ] Phase list is complete (through Reflect), each with a linked phase file
- [ ] Research file (`research.md`) exists and contains facts-only current-state discovery
- [ ] Design artifacts exist (C4, DFD, Sequence) and match research facts where applicable
- [ ] Resolved questions section addresses all open decisions
- [ ] No phase file is missing or has a broken crosslink

### Plan Quality Checklist

- [ ] Every phase has: Goal, Model Tier, Scope, Checklist, Verification Commands, Acceptance Criteria
- [ ] Required Rules are listed in phases that need them (audit, docs)
- [ ] Scope sections specify exact file paths, not vague descriptions
- [ ] Checklist items are atomic and verifiable (not "implement the feature")
- [ ] Acceptance criteria are testable (grep scans, command outputs)
- [ ] Mandatory lifecycle phases are present: Post-code, Audit/Hardening, Docs (if API changed)
- [ ] Phase dependencies are explicit (handoff notes say what the next phase needs)

### Risk Assessment Checklist

- [ ] Breaking changes are identified (env var renames, API contract changes)
- [ ] Rollback strategy exists for destructive changes
- [ ] All affected modules are identified
- [ ] Security-sensitive paths are flagged (auth, tokens, session strings, env vars)
- [ ] No implicit assumptions — every assumption is stated and validated in research

### Anti-Patterns to Flag

- Vague scope: "update all files" without listing them
- Deferred-and-forgotten: items deferred to later phases that have no phase file
- Test-blind: no test phase for changed modules (when test runner is present)
- Docs-blind: no docs sync phase for user-facing behavior changes
- One-way door: destructive changes with no rollback plan

## Post-Implementation Audit

Run after all implementation phases are done.

### Completeness Verification

- [ ] Every phase is marked `done` in the plan index
- [ ] Every phase has an Evidence Note documenting what was actually done
- [ ] Every phase has a Handoff Note for the next phase
- [ ] Reflect phase exists with lessons learned and tech debt capture

### Plan-to-Code Drift Detection

- [ ] All files listed in research "Affected Files" section were actually modified
- [ ] No planned changes were silently skipped or deferred without documentation
- [ ] Grep scan confirms zero stale references for removed/renamed identifiers
- [ ] Build passes (`npm run build`)
- [ ] Lint passes (`npm run lint`)
- [ ] Documentation matches implemented behavior (no stale examples, env vars, or endpoint paths)

### Stale Artifact Sweep

- [ ] No old env var names or endpoint paths in source code or docs
- [ ] No TODO/FIXME comments from the plan remain unresolved
- [ ] No "deferred to Phase X" items left unaddressed
- [ ] `.env.example` is current with all required variables

## Process

1. Identify plan path: `docs/plans/<plan-name>/<plan-name>-implementation-plan.md`
2. Read all plan files: index, all phase files, research, design artifacts
3. Choose audit type: pre-implementation or post-implementation (all phases done)
4. Run applicable checklists from above, recording PASS/FAIL for each item
5. Cross-reference with codebase: use Grep/Glob to verify claims in evidence notes
6. Report findings grouped by severity: CRITICAL > HIGH > MEDIUM > LOW
7. Propose fixes for each finding with specific file paths and changes

## Output

- Summary table: `| Check | Status | Notes |`
- Findings grouped by severity with file paths and line context
- Recommended actions with priority ordering
- For post-implementation: draft reflect.md content if missing

## Related Rules

- `ai/rules/common/implementation-plans.md` — plan lifecycle and phase structure
- `ai/rules/common/post-code-workflow.md` — quality gate sequence (lint, format, build)
- `ai/rules/common/skills/refactor-security-audit.md` — code-level audit checklist
