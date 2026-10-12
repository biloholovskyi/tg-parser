---
paths:
  - "CHANGELOG.md"
  - "package.json"
---
# Versioning and Changelog

Mission: keep the target version consistent across `package.json`, the git branch, and `CHANGELOG.md`, and record every completed task in the changelog — as commit preparation only, never as an automatic commit.

## Constants

- CHANGELOG_FILE = `CHANGELOG.md`
- VERSION_FILE = `package.json` (`version` field)
- VERSION_BRANCH_PREFIX = `r-`
- VERSION_FORMAT = `X.Y.Z`
- CHANGELOG_VERSION_HEADER = `[X.Y.Z] DD.MM.YYYY` (plain line, no heading marker — match the existing file)
- CHANGELOG_BULLET_PREFIX = `- ` (a plain list item; no ticket or project tag)
- CHANGELOG_DATE_FORMAT = `DD.MM.YYYY`
- CHANGELOG_ENTRY_ORDER = newest completed task at the top of the version's bullet list
- CHANGELOG_NEWEST_VERSION_POSITION = top of the file

## When These Checks Run

- Before planning: ask the user for the target version (VERSION_FORMAT) before writing any plan.
- During a plan: the CHANGELOG update is a Finalize checklist item, before commit-prep.
- Before an out-of-plan commit: run the full consistency check when the user asks to commit.

These are preparation actions. Never run `git commit` on your own, and never add a commit step to a plan — see `.claude/rules/git-conventions.md`.

## Consistency Check (Three Gates)

Run all three against the target version before a commit.

1. Branch gate
   - The current branch must equal VERSION_BRANCH_PREFIX plus the version, for example `r-1.3.1` for `1.3.1`.
   - On mismatch: propose `rtk git checkout -b r-{version}` and switch only after explicit user approval. Do not create or switch branches on your own.

2. Version-file gate
   - `version` in VERSION_FILE must equal the target version.
   - On mismatch: update the `version` field to the target version as a prep edit.

3. Changelog gate
   - If a `[version] ...` header already exists:
     - Ensure its date equals today in CHANGELOG_DATE_FORMAT; update a stale date.
     - Prepend a new bullet for the completed task at the top of that version's list.
   - If no header for the target version exists:
     - Add a new `[version] DD.MM.YYYY` section with today's date at the top of CHANGELOG_FILE, with the task bullet.

## Changelog Entry Rules

- One bullet per completed task, written as CHANGELOG_BULLET_PREFIX plus the description; brief but self-explanatory (what changed, not how).
- No prefix, tag, or ticket marker in front of the description. The former `- [TGS] - ` prefix was dropped and must not be reintroduced.
- Newest completed task at the top of the version's list.
- Match the surrounding language and style of the file; keep code identifiers as-is.
- Header format follows CHANGELOG_VERSION_HEADER exactly — a plain bracketed version line, not a Markdown heading.
- Preserve the file's existing CRLF line endings.

## Anti-Patterns

- Planning without first asking the target version.
- Adding a `git commit` step to a plan, or committing without an explicit user request.
- Committing with the branch, VERSION_FILE, and CHANGELOG_FILE out of sync.
- Introducing a heading marker or a different bullet prefix that breaks the existing changelog style.
- Prefixing a bullet with a project or ticket tag such as `[TGS]`.
- Stale changelog date on an existing version header.
- Appending a new task bullet to the bottom instead of the top.
- Creating or switching branches without explicit user approval.

## Related Rules

- `.claude/rules/git-conventions.md` — commit authorization, branch naming, pre-commit checklist
- `.claude/rules/implementation-plans.md` — changelog step placement in the plan lifecycle
- `.claude/rules/post-code-workflow.md` — quality gates before commit
- `.claude/rules/commit-message-and-crosslinks.md` — commit metadata
