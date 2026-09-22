---
name: audit-resources
description: Audit runtime resources, leaks and hosting cost via the resource-leak-auditor agent
---

# /audit-resources

## Instructions

Delegate to the `resource-leak-auditor` agent (`.claude/agents/resource-leak-auditor.md`). The canonical checklist is `.claude/rules/runtime-resources.md`.

1. Determine the scope from `$ARGUMENTS`. If omitted, audit the whole runtime surface: `src/telegram/`, `src/main.ts`, `src/app.module.ts`, `railway.toml`.
2. Launch the agent. It traces caches, client lifecycles, timers, external-call options, synchronous I/O, process-termination handlers, log volume, and iteration ceilings.
3. The agent verifies library defaults by reading `node_modules/` rather than assuming them, and quantifies each leak as growth per request, per session, or per hour.
4. Report findings ranked CRITICAL > HIGH > MEDIUM > LOW, each with the file, the line, what retains the resource, and what should release it.
5. Nothing is fixed by this skill. Hand remediation to `tg-parser-backend-expert`, and the lifecycle tests to `test-writer`.

## Output

- Report path under `docs/reviews/`
- The findings by severity, with growth rates
- The three changes that remove the most cost

## Arguments

- `$ARGUMENTS` — target module, file path, or glob. If omitted, audit the whole runtime surface.
