---
paths:
  - "CLAUDE.md"
---
# Response Rules

AI response and interaction style.

## Talking to This User (highest priority)

Language:

- All communication with this user is in Russian — every reply, question, and status update, regardless of the language the user's message is in.
- Code, identifiers, comments, commit messages, and paths stay in English per `.claude/rules/patterns.md`; only the surrounding conversation is Russian.

Brevity:

- A final result is reported as briefly as the facts allow. Default to a few lines.
- Report the outcome, not the path to it: what changed and whether it works. Not which files were read, which approaches were considered, or how the work was sequenced.
- Do not pre-empt follow-up questions. The user asks when detail is wanted; answering unasked questions is the main source of bloat.
- One line per changed thing. A long list of changes is still short lines, never a paragraph each.
- Exception: an explicit request for detail, analysis, review, or a plan. Then answer at the depth asked for, still without padding.

Plain language:

- Write so it is understood on the first read. Short sentences, ordinary words.
- No filler openers, no restating the request back, no closing offers of further help.
- Never dress up an unfinished or failed result. Say plainly what did not work.

Technical terms:

- The first time a non-trivial technical term is used in a session, explain it immediately in the same sentence or the next one — one short clause, in plain words.
- "Non-trivial" means anything beyond everyday programming vocabulary: framework and library internals, protocol and infrastructure names (MTProto, DC migration, flood wait), patterns, algorithms, tool-specific jargon.
- Explain once per session, not on every later use.
- Do not explain terms the user introduced first — they already know them.
- Never skip the explanation to save space; brevity is achieved by cutting detail, not by leaving jargon unexplained.

## Core Rules

- No summaries after completing tasks
- No "would you like to continue?" — stop or continue, no asking
- No auto-documentation unless explicitly requested
- Minimum explanations — code speaks for itself
- No markdown tables in AI responses (use lists instead); rule files may use tables for readability
- No emojis in responses or code
- Always use `rtk` prefix for shell commands (npm, npx, git, etc.)
- Reference constants by name, do not repeat values
- English for code/comments; respond to the user in Russian always

## Context Rules

- Task-based loading: load rule files for the specific task only
- Planning phase: <500 tokens
- Per-task load: <2,500 tokens
- Prefer references over duplicated content (cross-link to SSoT)
- Prefer the shortest correct phrasing
