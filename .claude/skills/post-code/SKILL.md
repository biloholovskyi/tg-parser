---
name: post-code
description: Run the standard post-code QA workflow — lint, format, build
model: inherit
---

# /post-code

Run mandatory quality checks after code changes.

## Instructions

- Load `@ai/rules/common/post-code-workflow.md` and follow its process.
- Run steps in order: `npm run lint`, `npm run format`, `npm run build`.
- Stop on first failure, report the error, and propose a fix.
- After all fixes are applied, re-run the full sequence to confirm clean pass.
- Report results with failures first, then passing steps.
