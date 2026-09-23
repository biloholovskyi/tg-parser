---
name: project-test-run-environment
description: Running Jest here from the Bash tool needs `rtk npm.cmd test` (plain `rtk npm` fails with "program not found"); jest rootDir is src, so unit specs must live under src/
metadata:
  type: project
---

When running the test suite through the Bash (Git Bash) tool on this Windows machine, use `rtk npm.cmd test`. Plain `rtk npm test` fails with `Error: Failed to run npm / program not found`. The same applies to `rtk npx.cmd <tool>`.

**Why:** `rtk` resolves the executable directly and does not find the `npm`/`npx` shell shims from the Git Bash environment; only the `.cmd` entry points resolve.

**How to apply:** Use `rtk npm.cmd test` / `rtk npm.cmd run test:e2e` / `rtk npx.cmd eslint <files>` from Bash. In PowerShell the documented `rtk npm test` form works, so keep writing it that way in reports and rule text.

Related detail worth remembering: the unit Jest config sets `rootDir: src`, so a spec placed outside `src/` is silently never run. Lint the new specs with `rtk npx.cmd eslint <paths> --fix` rather than `npm run lint`, because the project lint script auto-fixes production files too — which this agent must not touch.

Writing a multi-line spec file through a Bash heredoc (`cat > file <<'EOF'`) fails here with `unexpected EOF while looking for matching quote`, even for content with balanced quotes. Use the Write tool for new spec files and keep Bash for running commands.
