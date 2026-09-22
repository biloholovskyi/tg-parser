---
paths:
  - "docs/reports/**"
  - ".claude/skills/plan-report/**"
  - ".claude/agents/report-writer.md"
---
# Report Generation

Mission: a completed `standard`-tier plan (see Complexity Tier in `.claude/rules/implementation-plans.md`) produces a Markdown completion report and a row in the reports index; a missing report blocks the `done` status. `small` and bugfix plans produce no report.

## Constants

- REPORTS_DIR = `docs/reports/`
- REPORT_INDEX = `docs/reports/README.md`
- REPORT_NAME = `{component}-{version}-{YYYY-MM-DD}.md`
- INDEX_ORDER = newest-first
- REPORT_SKILL = `plan-report`
- REPORT_AGENT = `report-writer`
- REPORT_LANGUAGE = Russian (identifiers, paths, and commands stay as-is)

## Ownership

| Component | Role |
|-----------|------|
| `report-generation.md` (this file) | SSoT: content, storage, index, gate |
| REPORT_AGENT | writes the report file and upserts the index row |
| REPORT_SKILL | orchestration: gather data, run the agent, verify the gate |
| `implementation-plans.md` | declares the Report closeout item and the hard gate |

## Mandatory Report Sections

| Section | Content | Source |
|---------|---------|--------|
| Summary | What was built, in 2-3 sentences | plan index Mission |
| Phases | Each phase, its status, and one line of evidence | phase files, `history.md` |
| Affected files | File list with change size | `rtk git diff --stat` from the plan base |
| Test evidence | Commands actually run and their result (suites, tests, pass/fail) | the real `rtk npm test` / `rtk npm run test:e2e` output |
| API artifacts | Links to `docs/testing/*` when endpoints or contracts changed | `.claude/rules/api-contracts.md` |
| Problems and tech debt | Known issues, deferred items, follow-up work | `reflect.md`, phase evidence notes |

## Rules

- Report only what was actually observed. No estimated numbers, no invented token or timing figures.
- If a command was not run, say so — do not present an assumption as evidence.
- No secrets in a report: never include a `sessionString`, API hash, phone number, or a private-channel payload, even as an example.
- The report is a plain Markdown file, self-contained, with relative links to plan and testing artifacts.
- REPORT_INDEX rows are newest-first and the upsert is idempotent: re-running the skill updates the existing row rather than appending a duplicate.
- The report step never commits.

## Hard Gate (`standard` only)

A `standard` plan is not `done` until:

- `docs/reports/{component}-{version}-{YYYY-MM-DD}.md` exists, and
- `docs/reports/README.md` contains a row linking to it

## Anti-Patterns

- A report for a `small` or bugfix plan
- Fabricated metrics, or test counts copied from an earlier run
- A report that duplicates the plan instead of recording outcomes
- Appending a second row for the same report instead of updating it
- Marking a `standard` plan `done` with the gate unmet

## Related Rules

- `.claude/rules/implementation-plans.md` — Report closeout item
- `.claude/rules/plan-execution.md` — Finalize checklist
- `.claude/agents/report-writer.md` — the report author agent
