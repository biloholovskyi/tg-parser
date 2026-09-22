---
name: commit
description: Generate a conventional commit from staged changes for tg-parser
---

# /commit

Generate a conventional commit from staged changes.

## Instructions

- Run `rtk git status` and `rtk git diff --cached` to understand the staged changes.
- If nothing is staged, check `rtk git diff` and suggest what to stage (prefer specific files over `git add .`).
- Before the commit runs:
  - Remind to run `/post-code` if code changed and no lint/build/test evidence exists in this session.
  - Confirm new or changed functionality has tests (`.claude/rules/testing.md`); if not, recommend `/write-tests` first.
  - Scan the staged diff for secrets: a session string, `TELEGRAM_API_HASH`, phone number, or a `.session` file must never be committed. Stop and report if one appears.
  - Run the version and changelog gate (`.claude/rules/versioning-changelog.md`):
    - Confirm the target version (`X.Y.Z`); ask the user if it is not already established this session.
    - Branch gate: the current branch must equal `r-{version}`; on mismatch propose `rtk git checkout -b r-{version}` and switch only on explicit approval.
    - Version-file gate: update `package.json` `version` to the target version if it differs.
    - Changelog gate: ensure `CHANGELOG.md` has a `[version] DD.MM.YYYY` header with today's date and the completed task as the top bullet, using the existing `- [TGS] - ` bullet style.
- Determine the commit `type` (feat, fix, refactor, perf, test, chore, docs, style, ci, build, revert) and `scope` from the changed files:
  - `telegram` for the Telegram module
  - `config` for configuration loaders
  - `shared` for `src/shared/`
  - `root` for top-level config, `main.ts`, `app.module.ts`
  - `deploy` for `railway.toml`
  - `claude` for `.claude/` rules, agents, skills
- Compose the message per `.claude/rules/git-conventions.md` and `.claude/rules/commit-message-and-crosslinks.md`:
  - Subject: `type(scope): imperative description` (<= 72 chars, no period)
  - Body: optional, explain why not what
  - Footer: `BREAKING CHANGE:` if applicable
  - Do NOT include `Co-authored-by:` trailers
- Present the full message for confirmation before committing.
- On approval run `rtk git commit -m "<message>"` (use a heredoc for multi-line bodies).

## Arguments

- `$ARGUMENTS` — optional scope hint or issue reference to include in the body or footer.
