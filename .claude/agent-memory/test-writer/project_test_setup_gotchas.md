---
name: project-test-setup-gotchas
description: Non-obvious setup facts for tg-parser specs — AppModule reloads the repo .env during compile, process listener bookkeeping needs a narrowed process view, DTO specs must mirror the pipe's (empty) transformOptions, and module-level latches need a reset seam
metadata:
  type: project
---

Setup facts that cost a debug cycle each when writing specs here.

1. An E2E spec that must run with `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` absent has to delete them
   again in `beforeEach`, not only before the app is created. `AppModule` wires
   `ConfigModule.forRoot({ envFilePath: '.env' })` and a real `.env` with live values exists in the
   repo root, so compiling the testing module puts the variables back into `process.env`.

2. A spec that saves and restores `process` listeners cannot call `process.listeners(name)` /
   `process.on(name, ...)` with a plain string: the `@types/node` overloads only accept
   `NodeJS.Signals` there, so `'unhandledRejection'` fails to compile. Cast `process` once to a
   narrow `{ listeners, listenerCount, removeAllListeners, on }` view for bookkeeping and keep using
   the typed `process.emit` to raise the events.

3. A DTO spec must call `plainToInstance` with no `transformOptions`, because `buildValidationPipe`
   in `src/shared/utils/http-pipeline.ts` sets none. A spec that passes
   `enableImplicitConversion: true` silently tests a pipeline the service does not have.

4. A production module that keeps state in a module-level variable (the one-shot shutdown latch in
   `process-handlers.ts`) leaks that state between `it` blocks, because Jest loads the module once
   per file. Call the module's reset seam in `beforeEach` AND `afterEach`, and for a promise that
   never settles use `jest.useFakeTimers()` plus `await jest.advanceTimersByTimeAsync(...)` — the
   sync `advanceTimersByTime` does not let the awaited rejection propagate.

**Why:** all of these produce failures that look like production bugs (env "not absent", a type error
on a correct-looking call, a test that passes alone and fails in a suite) rather than test-harness
problems.

**How to apply:** when bootstrapping `AppModule` in `test/*.e2e-spec.ts`, or when a unit spec
attaches real process handlers. See also [[project-test-run-environment]].
