# Agent Memory

This folder is the single memory home for `tg-parser` Claude Code agents. Each agent has its own `<agent>/MEMORY.md` index for project-scoped, persistent memories.

Use memory only for information that is not derivable from source code, git history, or documented project rules:

- User collaboration preferences.
- Long-lived project decisions and constraints.
- External system references.
- Feedback that should shape future agent behavior.

Do not store:

- Code structure facts.
- File path inventories.
- Debugging recipes that belong in code or commits.
- Temporary task state.
- Secrets, tokens, credentials, session strings, phone numbers, or personal data.

The last point is a hard rule in this project: a `sessionString`, `TELEGRAM_API_HASH`, or phone number must never reach a memory file, even as an example.

## Layout

- `<agent>/MEMORY.md` — per-agent memory index. When saving a new memory, add a one-line pointer in the relevant section (User / Feedback / Project / Reference) with a link to the memory file.
- `<agent>/<slug>.md` — an individual memory, when one line in the index is not enough.
