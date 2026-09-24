---
paths:
  - "src/**/*.ts"
  - "test/**/*.ts"
---
# Patterns (TypeScript, Testing, Error Handling, Async)

Consolidated code patterns. Complements `.claude/rules/architecture.md` and `.claude/rules/typescript.md`.

## Mission

Deliver correct, maintainable code while minimizing tokens. Rule hierarchy: Core Rules → Task Rules → Source Files → Heuristics.

## Priority Stack

1. Safety and compliance (no secrets, no session leaks, no data loss)
2. Correctness vs spec and tests
3. Architecture alignment (DRY, KISS, YAGNI, SOLID)
4. Token economy and latency
5. Style consistency

## Decision Protocol

- Load `.claude/rules/architecture.md` and `.claude/rules/post-code-workflow.md` before coding
- For Telegram-facing work also load `.claude/rules/telegram.md`
- Resolve conflicts: newest explicit instruction > repo rules > general heuristics
- If requirements are ambiguous: proceed with documented assumptions unless risk is high (secret exposure, breaking API, account ban)
- Plan first: split tasks, identify dependencies, list assumptions and risks

## Constants

Code Quality:
- FUNCTION_MAX_LINES = 20
- FUNCTION_REFACTOR_LINES = 30
- CLASS_MAX_LINES = 200
- CLASS_MAX_METHODS = 10
- MAX_NESTING_DEPTH = 3
- DUPLICATION_THRESHOLD = 3
- MAX_PARAMS_WITHOUT_RO_RO = 5
- FOLDER_FLAT_THRESHOLD = 7

Testing:
- DEFAULT_TEST_COVERAGE_TARGET = 0.8
- TEST_COVERAGE_UNIT_TARGET = 0.8
- TEST_COVERAGE_INTEGRATION_TARGET = 0.7

Retry/Backoff:
- MAX_RETRY_ATTEMPTS = 3
- INITIAL_BACKOFF_MS = 1_000
- MAX_BACKOFF_MS = 5_000
- BACKOFF_MULTIPLIER = 1.2

## Constants Organization

- Location: `src/shared/constants/` or module-local `constants.ts`
- Structure: export const objects with `as const` for type safety
- Naming: SCREAMING_SNAKE_CASE, include units (MS, KB, COUNT)
- Extract when: used in 2+ places, the value has semantic meaning, or it needs documentation
- Inline exceptions: `count === 0`, `index === -1`, `array[0]`, HTTP status codes in tests

## Decision Matrix

| Need | Solution | When |
|------|----------|------|
| Error handling | Throw `NotFoundException`, `BadRequestException`, `UnauthorizedException` | NestJS standard errors |
| Error handling (domain) | Result pattern `{ ok: true; value: T } \| { ok: false; error: E }` | Expected business-logic errors |
| Async parallel | `Promise.all()` | Independent tasks, never against one Telegram account |
| Async sequential | `for...of` with `await` | Dependent tasks and MTProto iteration |
| Type safety | Branded types | Opaque domain strings (session string) |
| Magic numbers | Extract constant | 2+ uses (except 0, 1, -1) |
| Magic strings | Extract constant | Protocol/domain literals 2+ uses |
| Input validation | `class-validator` decorators on request DTOs | All REST request bodies, params, queries |
| Retry logic | Exponential backoff with jitter | Transient network failures only |
| Rate limiting | Explicit backoff honoring the Telegram wait | `FLOOD_WAIT_X` |
| External API access | Dedicated injectable service | All GramJS calls, inside `src/telegram/` |
| Testing | AAA pattern (Arrange-Act-Assert) | All unit tests |

## Preferred Paradigms

- Functional core, imperative shell: business logic pure; isolate I/O and mutation at NestJS service boundaries
- Composition over inheritance: small composable functions and services, not deep class hierarchies
- Explicit effects: model async and errors via return types and exceptions, not hidden globals
- Immutability by default: `readonly`, `as const`, spread over in-place mutation
- Declarative DTOs: `class-validator` decorators describe the contract

## Requirements

### Naming

- Classes: PascalCase (`TelegramService`, `TelegramController`)
- Variables/Functions: camelCase
- Files: kebab-case (`telegram.service.ts`, `message.interface.ts`)
- Constants: SCREAMING_SNAKE_CASE
- Environment Vars: UPPERCASE (`TELEGRAM_API_ID`)
- Booleans: verb prefix (`isConnected`, `hasSession`, `canFetch`)
- English only

### Functions

- Length: <FUNCTION_MAX_LINES (refactor at FUNCTION_REFACTOR_LINES)
- Naming: verb + noun (`fetchChannelPosts`, `evictSession`)
- Pattern: RO-RO (object in, object out) at MAX_PARAMS_WITHOUT_RO_RO params or more
- Nesting: <= MAX_NESTING_DEPTH
- Single responsibility
- Extract duplicates at DUPLICATION_THRESHOLD
- Prefer pure; isolate side effects at service boundaries

### TypeScript

- No new `any`; prefer `unknown` plus narrowing (see `.claude/rules/typescript.md`)
- Write to strict semantics; the compiler enforces `strictNullChecks` and `noImplicitAny` (`.claude/rules/typescript.md`)
- No magic numbers with 2+ uses (extract)
- One primary export per file; related secondary exports allowed when cohesion is high
- JSDoc on public service methods
- English only
- Prefer `import type` for type-only imports
- Prefer const objects over enums
- Request DTOs in `dto/`, response shapes in `interfaces/`

### NestJS Specifics

- `@Injectable()` on services, constructor injection only
- `@Controller('route')` with `@Get/@Post/@Put/@Patch/@Delete` for REST
- Request DTOs in `dto/`, always with `class-validator`
- A global `ValidationPipe` is the enforcement point for DTO validation
- Use the NestJS `Logger` with the module name as context, never `console.log`
- Exceptions: `NotFoundException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `ConflictException` from `@nestjs/common`

### Async

- Default: `async/await`
- Parallel: `Promise.all()` (independent) or `Promise.allSettled()` (partial failures)
- Sequential: `for...of` (dependent, and all MTProto iteration)
- Timeouts: `AbortSignal` or `Promise.race()` on every external call
- Retry: exponential backoff with jitter; only on transient failures
- Never: `async void`, `forEach` with async, unbounded parallelism, no timeout on external I/O

### Error Handling

- Expected errors: Result pattern or NestJS exceptions
- Unexpected errors: throw and let the NestJS handler catch
- Preserve the original with `cause: err` when wrapping
- Never log secrets, session strings, phone numbers, codes, or full private-channel payloads
- Use the NestJS `Logger` with structured context, never `console.error`
- HTTP status mapping via NestJS exceptions:
  - `NotFoundException` → 404
  - `BadRequestException` → 400
  - `UnauthorizedException` → 401
  - `ForbiddenException` → 403
  - `ConflictException` → 409
  - `InternalServerErrorException` → 500
- Telegram-specific mapping is in `.claude/rules/telegram.md`
- Retry: transient network errors only, max MAX_RETRY_ATTEMPTS, exponential backoff

### Validation

- All request DTOs must use `class-validator` decorators
- REST body, param, and query validation goes through the global `ValidationPipe`
- No unvalidated external input reaches the service layer
- Channel usernames and time-window parameters are validated before any MTProto call

### Testing

- Framework: Jest (unit) and Supertest (E2E)
- All functionality must be covered by tests — see `.claude/rules/testing.md`
- Pattern: AAA (Arrange-Act-Assert)
- Coverage targets: unit >= TEST_COVERAGE_UNIT_TARGET, integration >= TEST_COVERAGE_INTEGRATION_TARGET
- Naming: `inputX`, `mockX`, `actualX`, `expectedX`
- Mock GramJS in unit tests — never open a real MTProto connection
- Do not mock third-party deps that are fast and cheap to execute (`class-validator`)

### Dependency Hygiene

- Prefer existing utilities; add deps only when justified
- Modules side-effect free on import; expose factory functions or NestJS modules
- CI installs use a frozen lockfile (`npm ci`)

### Security

- Perimeter rules (caller auth, rate limits, CORS, credential transport) are in `.claude/rules/api-security.md`
- Resource ceilings and release paths are in `.claude/rules/runtime-resources.md`
- Validate and sanitize all untrusted input at boundaries (HTTP, env)
- Never `eval` / `new Function` on user input
- Logging hygiene: never log secrets, session strings, API hashes, phone numbers, PII
- Key material only from env vars, read through `src/config/`
- Do not echo request bodies of authenticated endpoints into logs

### Observability

- NestJS `Logger` with the module name as context
- No `console.*` in production code
- Log the fact of an operation and its outcome, never its sensitive payload
- Log volume is a billed resource: one line per request outcome, never one per iterated item
- Progress, counters and cache internals belong to a debug level that is off by default

## Anti-Patterns

- Magic numbers with 2+ uses and no constant
- Magic strings with 2+ uses and no constant
- New `any` types
- Functions > FUNCTION_MAX_LINES
- Multi-param (> MAX_PARAMS_WITHOUT_RO_RO) without RO-RO
- Nesting > MAX_NESTING_DEPTH
- Duplication > DUPLICATION_THRESHOLD without extraction
- Generic errors (`throw new Error('Failed')`)
- No error context
- `async void`, `forEach` with async
- No timeout on external I/O
- Retry on terminal errors (invalid code, revoked session)
- Swallowing errors (`catch (err) { }`)
- Logging session strings or any credential
- `eval` / `new Function`
- Side effects in module imports
- `console.log` in committed code
- GramJS imports outside `src/telegram/`
- Synchronous filesystem calls on a request path
- An unbounded cache of live connections
- `process.exit` in a generic error handler
- Shipping functionality without tests

## Output Expectations

- Updates: concise bullet lists (no post-task summary)
- Reference files and identifiers with backticks; omit line numbers
- Call out assumptions, risks, and required follow-up (tests, manual validation)
