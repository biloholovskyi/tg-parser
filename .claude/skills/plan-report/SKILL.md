---
name: plan-report
description: Generate the plan-completion report (summary, phases, affected files, test evidence, tech debt) and upsert the reports index. Run as the Report closeout item of Finalize for standard-tier plans. small and bugfix plans skip it.
---

# /plan-report

## Instructions

Orchestrate report generation for a completed plan. Gather the evidence, delegate authoring to the `report-writer` agent, then verify the hard gate. Never commit.

Authoritative spec: `.claude/rules/report-generation.md`.

1. Resolve the target:
   - Component and version from `docs/plans/<component>/<component>-implementation-plan.md` (target version) and the branch.
   - Confirm the tier is `standard`. If the plan is `small` or bugfix, state that no report is required and stop.
2. Gather supporting data — real evidence only:
   - Test results: the actual output of the `rtk npm test` and `rtk npm run test:e2e` runs performed for this plan. If a suite was not run, record that instead of a number.
   - Affected files: `rtk git diff --stat` from the plan base.
   - Phase evidence: `docs/plans/<component>/history.md` and the per-phase evidence notes.
   - API artifacts: links to `docs/testing/*` when endpoints or contracts changed.
3. Author the report — delegate to the `report-writer` agent, passing the plan folder path, the test evidence, and the diff stat.
   - The agent writes `docs/reports/<component>-<version>-<YYYY-MM-DD>.md` with all mandatory sections and upserts the row in `docs/reports/README.md` (newest-first, idempotent).
4. Verify the gate:
   - The report file exists AND `docs/reports/README.md` has a row linking to it.
   - Report both paths to the user. Do NOT mark the plan `done` if the gate fails.

## Hard Rules

- Report only observed facts. No estimated or invented metrics.
- No secrets in the report: never a session string, API hash, phone number, or private-channel payload.
- Plain self-contained Markdown, written in Russian, with relative links.
- This skill and the `report-writer` agent never run `git commit`.

## Arguments

- `$ARGUMENTS` — optional component name. If omitted, infer it from the active plan folder.

## Related Rules

- `.claude/rules/report-generation.md` — report SSoT (content, storage, index, gate)
- `.claude/rules/implementation-plans.md` — Report closeout item of Finalize
- `.claude/agents/report-writer.md` — the report author agent
