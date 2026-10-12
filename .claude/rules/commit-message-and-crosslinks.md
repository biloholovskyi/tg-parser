---
paths:
  - ".claude/**/*"
  - "docs/**/*"
---
# Commit Message and Crosslinks

Commit metadata and cross-reference policy for rules, prompts, and docs.

## Constants

- COMMIT_SUBJECT_MAX_CHARS = 72
- COMMIT_FORBIDDEN_TRAILER = `Co-authored-by:`
- CROSSLINK_INTERNAL_STYLE = repo-root path
- CROSSLINK_RULE_PREFIX = `.claude/rules/`
- CROSSLINK_DOCS_PREFIX = `docs/`

## Requirements

Commit messages:
- Use the Conventional Commit format from `.claude/rules/git-conventions.md`
- Keep the subject line <= COMMIT_SUBJECT_MAX_CHARS
- Do not include COMMIT_FORBIDDEN_TRAILER in the commit body or footers
- Imperative mood, no period at the end of the subject

Crosslinks:
- Use CROSSLINK_INTERNAL_STYLE for internal markdown links (no `./` or `../` for rule and doc links)
- Link rules with `.claude/rules/...` paths
- Link docs with `docs/...` paths
- Keep references current when files move or are renamed; remove stale links
- When adding a new rule file, add a discoverable link from:
  - `.claude/rules/core-rules.md`
  - `.claude/rules/index.md`
  - `CLAUDE.md` when applicable

## Anti-Patterns

- Any `Co-authored-by:` trailer in commit messages
- Relative rule links like `./file.md` or `../rules/file.md`
- Orphan rules not referenced by the core indexes
- Keeping aliases or stubs to deleted files without explicit migration intent

## Related Rules

- `.claude/rules/git-conventions.md` — commit format and branch rules
- `.claude/rules/core-rules.md` — task-to-rule mapping
