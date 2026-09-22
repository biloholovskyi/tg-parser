---
name: debug
description: Investigate a defect to a proven root cause via the debugger agent, then ship the fix with a regression test
---

# /debug

## Instructions

Delegate the investigation to the `debugger` agent (`.claude/agents/debugger.md`). The agent proves the cause; it does not ship the fix.

1. Capture the symptom precisely from `$ARGUMENTS`: inputs, environment, frequency, expected behaviour. Narrow a vague report before investigating.
2. Launch the `debugger` agent. It writes down its hypotheses, falsifies rather than confirms, reads the installed library source when a default may be responsible, and builds the smallest failing reproduction with GramJS mocked.
3. Require a root cause with a file and a line. If the evidence does not reach that bar, the agent says the cause is unproven and lists what it ruled out — accept that rather than a guess.
4. Hand the fix to `tg-parser-backend-expert` and the regression test to `test-writer`. Per `.claude/rules/testing.md`, the regression test fails before the fix and passes after, and ships in the same change.
5. Run `/post-code` before reporting the defect as closed.

## Output

- Root cause with file and line, or an explicit statement that it is unproven
- The reproduction and how to run it
- The fix applied and the regression test that covers it
- Post-code results

## Arguments

- `$ARGUMENTS` — the symptom description. If omitted, ask for it.
