---
paths:
  - "docs/plans/**/*"
---
# Skill: Implementation Plan Audit

Audit implementation plans for completeness, risks, and implementation drift — pre-implementation (before coding starts) and post-implementation (after all phases are done).
Complements `.claude/rules/implementation-plans.md`.

Triggers:
- User asks to audit, review, or validate an implementation plan
- A plan reaches its exploration phase and needs a pre-implementation quality gate
- All implementation phases are done and the plan needs a post-implementation completeness check
- User wants to verify plan-to-code alignment before committing

## Pre-Implementation Audit

The plan must exist at `docs/plans/<plan-name>/<plan-name>-implementation-plan.md`.

### Plan Completeness Checklist

- [ ] Mission statement is clear and scoped (one sentence)
- [ ] Task profile is classified (feature / bugfix / hybrid) with signal counts
- [ ] Complexity tier is recorded with rationale
- [ ] Target version (`X.Y.Z`) recorded in the index, plus a changelog/version-sync closeout item; no `git commit` step in the plan
- [ ] Pre-code artifacts section exists with crosslinks to research and design files
- [ ] Rule coverage section lists all rules needed during implementation
- [ ] Phase list is complete and each phase file is linked
- [ ] `research.md` exists with facts-only discovery
- [ ] Design artifacts exist when complexity warrants (diagrams, ADR)
- [ ] Resolved-questions section addresses all open decisions
- [ ] No phase file is missing and no crosslink is broken

### Plan Quality Checklist

- [ ] Every phase has Goal, Scope, Checklist, Verification Commands, Acceptance Criteria
- [ ] Required Rules are listed in the phases that need them
- [ ] Scope sections specify exact file paths, not vague descriptions
- [ ] Checklist items are atomic and verifiable
- [ ] Acceptance criteria are testable (grep scans, command outputs, test counts)
- [ ] Finalize phase exists and carries the closeout checklist as items, not as separate gates
- [ ] Every feature phase has paired tests (`.claude/rules/testing.md`)
- [ ] Phase dependencies are explicit (handoff notes say what the next phase needs)

### Risk Assessment Checklist

- [ ] Breaking changes identified (REST contract changes, env var renames, response shape changes)
- [ ] Session-model impact assessed: does the change affect the in-memory session cache, client lifecycle, or auth flow
- [ ] Rate-limit impact assessed: does the change increase MTProto call volume for one account
- [ ] Rollback strategy exists for risky changes
- [ ] All affected modules identified
- [ ] Security-sensitive paths flagged (session strings, API credentials, phone numbers, 2FA)
- [ ] No implicit assumptions — every assumption stated and validated in research

### Anti-Patterns to Flag

- Vague scope: "update all files" without listing them
- Test-blind: no tests inside feature phases and no coverage audit for changed modules
- Deferred-and-forgotten: items deferred to later phases that have no phase file
- One-way door: risky changes with no rollback plan
- A change to the session model treated as a `small` plan
- A plan that adds an endpoint without the API test-artifacts closeout item

## Post-Implementation Audit

Run after all implementation phases are done but before the final commit.

### Completeness Verification

- [ ] Every phase marked `done` in the plan index
- [ ] Every phase has an evidence note documenting what was actually done
- [ ] Every phase has a handoff note for the next phase
- [ ] `history.md` captures significant decisions and discoveries
- [ ] `standard` tier: `reflect.md` exists with lessons learned and tech-debt capture
- [ ] `standard` tier: the completion report exists and the index links it (`.claude/rules/report-generation.md`)

### Plan-to-Code Drift Detection

- [ ] All files listed in the research "Affected Files" section were actually modified
- [ ] No planned change silently skipped or deferred without documentation
- [ ] Grep scan confirms zero stale references for removed or renamed identifiers
- [ ] Tests pass for the affected modules
- [ ] Documentation matches the implemented behavior

### Stale Artifact Sweep

- [ ] No old env var names, ports, routes, or paths left in source, tests, `railway.toml`, or docs
- [ ] `CLAUDE.md` Environment section matches the env vars the code actually reads
- [ ] No TODO/FIXME from the plan remain unresolved
- [ ] No "deferred to Phase X" items left unaddressed
- [ ] No test fixture contains a real credential

## Process

1. Identify the plan path: `docs/plans/<plan-name>/`
2. Read all plan files: index, all phase files, research, design, history
3. Choose the audit type: pre-implementation or post-implementation
4. Run the applicable checklists, recording PASS/FAIL for each item
5. Cross-reference with the codebase using grep and glob to verify claims
6. For post-implementation: run the stale-artifact sweep across the repo, excluding `node_modules`, `dist`, `coverage`
7. Report findings grouped by severity: CRITICAL > HIGH > MEDIUM > LOW
8. Propose fixes for each finding with specific file paths and changes

## Output

- Summary table: `| Check | Status | Notes |`
- Findings grouped by severity with file paths and line context
- Recommended actions with priority ordering
- For post-implementation: draft `reflect.md` content if missing

## Related Rules

- `.claude/rules/implementation-plans.md` — plan lifecycle and phase structure
- `.claude/rules/plan-execution.md` — phase execution and gates
- `.claude/rules/post-code-workflow.md` — quality gate sequence
- `.claude/rules/refactor-security-audit.md` — code-level audit checklist
- `.claude/rules/test-coverage-audit.md` — test coverage gap analysis
