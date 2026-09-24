---
name: project-test-setup-gotchas
description: Non-obvious setup facts for tg-parser specs — AppModule reloads .env on compile, narrowed process view for listeners, DTO pipe options, facade wiring and fs observation, concurrency gating, pre-fix proofs in a scratch copy, closing lifecycle providers in E2E
metadata:
  type: project
---

Setup facts that cost a debug cycle each when writing specs here.

1. An E2E spec that must run with `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` absent has to delete them
   again in `beforeEach`, not only before the app is created. `AppModule` wires
   `ConfigModule.forRoot({ envFilePath: '.env' })` and a real `.env` with live values exists in the
   repo root, so compiling the testing module puts the variables back into `process.env`.

   The same applies to env-backed perimeter config (`API_KEYS`): the `ApiKeyGuard` re-reads the
   environment on every request, so an E2E spec must set its fake key before `compile()` AND restate
   it in `beforeEach`, not only once.

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

5. A secret-hygiene assertion must spy on six `Logger.prototype` levels, not five: NestJS 10 adds
   `fatal` alongside `log`, `error`, `warn`, `debug`, `verbose`. Collect every level's
   `mock.calls.flat()`, `String()` each argument and join them, then assert the fixture secret is
   absent — an argument can be an object, and `toContain` on a raw object array silently passes.

6. A `createParamDecorator` param decorator (`SessionString`) hides its factory. To unit-test it,
   apply the decorator to a parameter of a plain fixture class, then read
   `Reflect.getMetadata(ROUTE_ARGS_METADATA, FixtureClass, 'handler')` (`ROUTE_ARGS_METADATA` comes
   from `@nestjs/common/constants`) and take `Object.values(...)[0].factory`. No bootstrapped
   controller and no E2E round trip is needed; call the factory as `factory(data, mockContext)` with
   a context stub whose `switchToHttp().getRequest()` returns `{ headers }`.

7. To prove a regression test would fail before a fix, `git show HEAD:<file>` is often unavailable here:
   much of `src/shared/` is still untracked on the feature branch, so there is no committed "before"
   state. Reimplement the old algorithm as a throwaway Node script in the session scratchpad and
   check that the new assertions flip, instead of editing the production file to re-break it.

8. `TelegramService` is a facade over `AuthService`, `ChannelService`, `SessionStore` and
   `TelegramClientFactory`. The black-box suite wires them by hand in a `buildService()` helper
   (factory -> store -> services -> facade), with `jest.mock('telegram')` (a fake class pushing itself
   into `mockCreatedClients`), `telegram/sessions`, `telegram/tl`, `telegram/Password`,
   `telegram/extensions/Logger` and `../config/telegram.config`. Store and auth each start one `unref`'d
   interval, so use fake timers and call `onModuleDestroy()` in `afterEach`. A "never touches disk"
   proof mocks `fs` as the actual module with `jest.fn(actual)` wrappers (sync and `promises`) and
   asserts zero calls plus `jest.isMockFunction`. To interleave concurrent requests, gate a call with a
   hand-made deferred (`mockReturnValueOnce(gate.promise)` or `jest.spyOn(sessions, 'adopt')`) and
   `await jest.advanceTimersByTimeAsync(0)` to let the other request run.

9. `expect(p).rejects.toThrow(new XException(msg))` fails here for mapped Telegram errors: this Jest
   version compares the `cause` too, and `toHttpException` always sets one. Assert `toBeInstanceOf`
   plus `.message` instead (a small `expectHttpError` helper in `telegram.service.spec.ts`).

10. The service filters with `instanceof Api.Message`. In the `telegram/tl` mock, make `Message` and
    `MessageService` real classes, then get them in the spec via
    `jest.requireMock('telegram/tl').Api` — top-level classes referenced from the factory hit the TDZ
    because the factory runs when the hoisted service import is required.

11. Since the console -> Logger switch, assert output with `jest.spyOn(Logger.prototype, level)`; it also
    catches module-level `new Logger('X')` instances (e.g. `telegram.config.ts`), so no module reset is needed.
    For "one line per request" assertions, clear the six-level spies after the arrange phase (auth
    itself logs) and count calls across all levels, not just `log`.

12. Fake Telegram RPC failures must carry the exact MTProto code in an `errorMessage` property (an
    `rpcError(code)` helper: `Object.assign(new Error(...), { errorMessage: code })`). Since the audit fix
    for block-03-05, `telegram-errors.ts` classifies only by that property; a plain `new Error('... CODE')`
    silently maps to 502. `SESSION_PASSWORD_NEEDED` is the exception: the service still checks it in
    `error.message`, which `rpcError` also satisfies.

13. To prove a regression test fails without a fix when the file is untracked: copy `src/` to the
    session scratchpad, restore the old logic there, and run
    `node node_modules/jest/bin/jest.js --config <scratch>/jest.config.js --runTestsByPath <spec>` from the
    repo, with a JS config holding `rootDir: 'src'`, `modulePaths: ['C:/Projects/tg-parser/node_modules']`
    and ts-jest by absolute path with `{ diagnostics: false }` (types do not resolve outside the repo).
    JSON configs and `--testPathPattern` against a temp path silently find nothing here.

14. A controller unit spec should `jest.mock('./telegram.service', () => ({ TelegramService: class {} }))`
    so the DI token exists without loading GramJS, then provide `{ provide: TelegramService, useValue: mock }`.
    Route metadata (`IS_PUBLIC_ROUTE_KEY`, `IS_PHONE_RATE_LIMITED_KEY`) is read with a plain `new Reflector()`.

15. The `PhoneRateLimitGuard` store lives on the guard instance, so it is shared by every `it` in one
    E2E spec file (one app per file) and counts digits only. Give each multi-step auth test its own fake
    number (`+100000000NN`) instead of reusing one; the limit is RATE_LIMIT_AUTH_MAX_REQUESTS per hour.
    For a no-network proof, `jest.mock('telegram', () => ({ ...jest.requireActual('telegram'), TelegramClient: jest.fn() }))`
    works in an E2E spec and also assert `jest.isMockFunction` so a no-op mock cannot pass silently.

**Why:** all of these produce failures that look like production bugs (env "not absent", a type error
on a correct-looking call, a test that passes alone and fails in a suite) rather than test-harness
problems.

**How to apply:** when bootstrapping `AppModule` in `test/*.e2e-spec.ts`, or when a unit spec
attaches real process handlers. See also [[project-test-run-environment]].

16. E2E specs override only the `TelegramService` facade, so the real `AuthService` and `SessionStore`
    are still built and each starts a sweep interval that nothing closes (the facade owns shutdown).
    Call `closeLifecycleProviders(app)` from `test/lifecycle-providers.ts` before `app.close()`.
