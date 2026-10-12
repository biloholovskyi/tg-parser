---
name: audit-plan
description: Audit an implementation plan (pre-implementation or post-implementation)
---

# /audit-plan

## Instructions

Run the full plan audit per `.claude/rules/plan-audit.md`.

1. Locate the plan: `docs/plans/<slug>/...` (ask for `<slug>` if not given).
2. Read the index, all phase files, `research.md`, design artifacts, and `history.md` when present.
3. Choose the audit type:
   - Pre-implementation: all phases `todo` and not yet executed.
   - Post-implementation: all phases `done`.
4. Run the applicable checklists from `.claude/rules/plan-audit.md`, recording PASS/FAIL for each item.
5. Cross-reference with the codebase (grep, glob) for any claim in an evidence note.
6. For post-implementation: run the stale-artifact sweep across the repo, excluding `node_modules`, `dist`, `coverage`.
7. Verify the `standard`-tier report gate when applicable (`.claude/rules/report-generation.md`).
8. Report findings grouped by severity (CRITICAL > HIGH > MEDIUM > LOW) with file paths.
9. Propose fixes with priority ordering.

Prefer dispatching the read-only `plan-auditor` agent for the file-reading and cross-referencing work.

## Output

- Summary table: `| Check | Status | Notes |`
- Findings grouped by severity
- Recommended actions
- For post-implementation: draft `reflect.md` content if missing

## Arguments

- `$ARGUMENTS` — plan slug or path; if omitted, ask.
