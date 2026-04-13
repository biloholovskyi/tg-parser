---
name: audit-security
description: Audit and refactor files for shared structure, constants extraction, type splitting, and security guardrails
model: inherit
---

# /audit-security

Audit for code quality, structure, and security.

## Instructions

- If target path/scope is missing, ask for it first.
- Load `@ai/rules/common/skills/refactor-security-audit.md` and follow its process.
- Report findings by severity and file path, including magic literals, type-export placement, and security risks.
- If user requests changes, apply minimal safe refactors and run `npm run lint`, `npm run format`, `npm run build`.
