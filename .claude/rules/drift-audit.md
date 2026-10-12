---
paths:
  - "CLAUDE.md"
  - ".claude/rules/**/*"
  - "README.md"
---
# Drift Audit

Mission: catch the gap between what the rules and docs claim and what the code actually does, before that gap becomes a wrong decision.

A rule that describes a system the code abandoned is worse than no rule: it is loaded into every session and trusted. Drift is found by reading the code, never by reading another document.

## When It Runs

- As a Finalize checklist item on every plan that changed `src/`, configuration, or the REST surface
- On demand via `/audit-drift`
- Before any architectural decision that cites an existing constraint as a given

## Claim Sources (checked against code)

- `CLAUDE.md` — Architecture, Session model, REST surface, Environment Variables, Quick Commands
- `.claude/rules/*.md` — every Constants block and every statement of fact about the running system
- `README.md` and root-level docs that describe behaviour or setup
- `railway.toml` — port, start command, health check path
- `package.json` — scripts named by any rule or skill

## Checks

| Claim | Verified against |
|-------|------------------|
| Session and persistence model | `src/telegram/session-store.ts` and `src/telegram/auth.service.ts` — what is actually stored and where |
| Declared REST surface | every `@Controller` and route decorator |
| Environment variables | every read in `src/config/` plus the deployed variable list |
| Constants in rule files | the literal values and options present in code |
| Scripts named in rules and skills | `package.json` scripts |
| Deployment facts (port, health path, start command) | `railway.toml` against `src/main.ts` |
| Version and changelog consistency | `.claude/rules/versioning-changelog.md` (owned there, reported here) |
| Agent and skill inventories | `.claude/agents/`, `.claude/skills/` against the lists in `CLAUDE.md` and `.claude/rules/index.md` |

## Resolution Protocol

Every finding is classified before anything is edited:

- Doc is wrong, code is right: update the doc or rule in the same change.
- Code is wrong, rule is right: the rule stands; the code defect is reported and scheduled, never silently legitimised by rewriting the rule.
- Both are defensible: it is an open architectural decision. Record it as a finding, state the fork, and take it to the user. Do not resolve it by editing either side.

A rule is never relaxed to match code without an explicit user decision. This is the point of the audit.

## Output

- Findings as a list: claim, source file, actual behaviour, classification, proposed action
- Explicit statement when no drift was found
- Nothing edited under classification three without user approval

## Anti-Patterns

- Verifying a document against another document
- Rewriting a rule to match whatever the code does
- Reporting drift without naming the file and the line that contradicts the claim
- Treating stale version or changelog data as acceptable noise
- Leaving a known contradiction in `CLAUDE.md`, the file loaded into every session

## Related Rules

- `.claude/rules/versioning-changelog.md` — version, branch and changelog gates
- `.claude/rules/implementation-plans.md` — where this runs in Finalize
- `.claude/rules/refactor-security-audit.md` — code-side audit
- `.claude/rules/token-economy.md` — single-source discipline that drift violates
