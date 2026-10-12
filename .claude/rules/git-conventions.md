---
paths:
  - ".git/**/*"
---
# Git Conventions

Commit messages, branch naming, and PR conventions for `tg-parser`.

## Commit Authorization (no automatic commits)

Committing is a manual, human-triggered action. Never run `git commit` (or `git add` then commit) on your own initiative.

- Commit ONLY when the user explicitly asks in the current turn (for example "commit", "сделай коммит", running `/commit`).
- A general instruction to implement, execute the plan, fix, refactor, or finish is NOT commit authorization. Do the work and leave the changes uncommitted for the user to review.
- This overrides any plugin skill or agent step that says to commit. Project rules win over plugin skills.
- Applies to all scenarios: the main agent, every dispatched subagent, per-phase plan execution, and the post-code workflow. A subagent must not commit unless its dispatch explicitly relays the user's commit request.
- Same gate for history-rewriting and publishing: no `git rebase`, `git reset`, `git push`, branch or tag mutation, or PR creation without an explicit user request.
- When work finishes without a commit request, report what changed and state that it is left uncommitted for manual review.

## Pre-Commit Version and Changelog Gate

Before any commit, run the three consistency gates in `.claude/rules/versioning-changelog.md`:

- Confirm the target version (`X.Y.Z`); ask the user if it is not already established this session.
- Branch gate: the current branch must equal `r-{version}`; on mismatch propose `rtk git checkout -b r-{version}` and switch only on explicit approval.
- Version-file gate: `package.json` `version` must equal the target version.
- Changelog gate: `CHANGELOG.md` has a `[version] DD.MM.YYYY` header with today's date and the completed task as the top bullet.

These are preparation actions only — never commit on your own and never add a commit step to a plan.

## Commit Message Format

`type(scope): short description`

Types:
- `feat` — new feature or capability
- `fix` — bug fix
- `refactor` — code change (no new feature, no fix)
- `perf` — performance improvement
- `test` — add or update tests
- `docs` — documentation only
- `chore` — build, tooling, deps
- `style` — formatting or whitespace (no logic change)
- `ci` — CI/CD pipeline changes
- `build` — build system or dependency changes
- `revert` — revert a previous commit

Scopes (module names without a path prefix):
- `telegram` — the Telegram feature module (auth, sessions, channel parsing)
- `config` — env-backed configuration loaders
- `shared` — cross-cutting helpers under `src/shared/`
- `root` — top-level config, `main.ts`, `app.module.ts`
- `deploy` — `railway.toml` and deploy configuration
- `claude` — `.claude/` rules, agents, skills

Rules:
- Subject line <= 72 chars, imperative mood, no period
- Explain why in the body when needed
- One logical change per commit
- Code changes that add or modify functionality include their tests in the same commit
- Do not use `Co-authored-by:` trailers
- See `.claude/rules/commit-message-and-crosslinks.md` for crosslink and trailer policy

Examples:
- `feat(telegram): add session validity endpoint`
- `fix(telegram): disconnect client on expired phone code`
- `refactor(telegram): extract post mapping into a helper`
- `chore(root): bump nestjs to v11`
- `test(telegram): cover flood wait mapping to 429`

## Branch Naming

Two patterns are in use:

- Release branches: `r-{version}` — the branch that carries a version's work, enforced by the version gate above.
- Task branches: `type/short-description`, or `type/ISSUE-ID-short-description` when a tracking ID exists.

Rules:
- Lowercase kebab-case
- Prefer <= 64 chars
- One logical task per branch

## PR Rules

Title: conventional style (`type(scope): description`)

Description should include:
- Summary (1-3 bullets, why not what)
- Test evidence (what was tested, commands run)
- Contract impact when a REST endpoint or response shape changed
- Breaking changes if any

## Anti-Patterns

- Committing without an explicit user request (auto-commit in any scenario, including subagents)
- Pushing, rebasing, resetting, or opening a PR without an explicit user request
- Mixing unrelated concerns in one commit
- Committing functionality without its tests
- Committing generated artifacts (`dist/`, `coverage/`) or secrets (`.env`, `*.session`)
- Committing a file containing a real `sessionString`, API hash, or phone number
- Force-pushing shared branches
- `Co-authored-by:` trailers
- Commits that do not build or lint
- Committing with the branch, `package.json` version, and `CHANGELOG.md` out of sync

## Related Rules

- `.claude/rules/commit-message-and-crosslinks.md` — commit metadata and link style
- `.claude/rules/post-code-workflow.md` — required checks before commit
- `.claude/rules/testing.md` — tests ship with the change
- `.claude/rules/versioning-changelog.md` — version/branch/changelog consistency gate
