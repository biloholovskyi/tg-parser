# AI Rules (Consolidated)

TypeScript, error handling, async patterns, constants.

## Mission

Deliver correct, secure, maintainable code while minimizing tokens. Obey rules hierarchy: Core Rules → Task Rules → Source Files → Heuristics.

## Priority Stack

1. Safety & compliance (no secrets, no data loss)
2. Correctness vs spec & tests
3. Architecture alignment (DRY, KISS, YAGNI, SOLID)
4. Token economy & latency
5. Style consistency

## Decision Protocol

- Load `CLAUDE.md` for project architecture before coding
- Resolve conflicts: newest explicit instruction > repo rules > general heuristics
- If requirements are ambiguous: proceed with documented assumptions unless risk is high (data loss, security, breaking API)
- Document assumptions when acting on inferred intent
- Think as expert: Apply 10+ years experience, consider edge cases, performance, security, maintainability
- Plan first: Split tasks, identify dependencies, list assumptions and risks

## Constants

### Definition Rules

- Extract numeric literals >1 (except 0, 1, -1 which are OK inline)
- Always extract values 10+ (use underscores: 10_000)
- Extract when used in 2+ places
- Extract when value has semantic meaning (not just a number)
- Extract when value might change or needs documentation

### Naming Rules

- SCREAMING_SNAKE_CASE
- Include units in name (MS, KB, PORT, COUNT, etc.)
- Descriptive: What it represents, not just the value
- Group related constants in same file

### Organization Rules

- Location: `src/shared/constants/` subfolder with logical grouping (timeouts.ts, limits.ts, etc.)
- Structure: Each category in separate file, export const objects (not individual constants)
- Naming: Use module prefix + singular name (TELEGRAM_TIMEOUT_MS, not TIMEOUTS)
- Export: Re-export all from `src/shared/constants/index.ts`
- Const objects: Group related constants in const objects with `as const` for type safety
- Usage: Destructure at call sites: `const { TIMEOUT_MS, MAX_RETRIES } = TELEGRAM_CONSTANTS;`
- Reference in JSDoc: `@default CONSTANT_NAME`
- Documentation: Each constant MUST have JSDoc comment explaining purpose, valid range (if applicable), and usage context

### Standard Constants

Code Quality:
- FUNCTION_MAX_LINES = 20
- FUNCTION_REFACTOR_LINES = 30
- CLASS_MAX_LINES = 200
- CLASS_MAX_METHODS = 10
- CLASS_MAX_PROPERTIES = 10
- MAX_NESTING_DEPTH = 3
- DUPLICATION_THRESHOLD = 3
- MAX_PARAMS_WITHOUT_RO_RO = 5
- FOLDER_FLAT_THRESHOLD = 7

Retry/Backoff:
- MAX_RETRY_ATTEMPTS = 10
- INITIAL_BACKOFF_MS = 1_000
- MAX_BACKOFF_MS = 5_000
- BACKOFF_MULTIPLIER = 1.2

### Inline Exceptions

OK to use inline (no constant needed):
- count === 0
- index === -1
- array[0] (first element)
- HTTP status codes in tests (200, 404, 500)
- Single-use values in tests

## Decision Matrix

| Need | Solution | When |
|------|----------|------|
| Error handling | Result pattern | Expected errors in business logic |
| Error handling | Throw exception | Unexpected errors, external I/O |
| Async parallel | Promise.all() | Independent tasks |
| Async sequential | for...of | Dependent tasks |
| Type safety | Branded types | Domain values (SessionId, PhoneNumber) |
| Magic numbers | Extract constant | 2+ (0,1,-1 OK inline) |
| Magic strings | Extract constant | Repeated protocol/domain literals |
| Code organization | Classes | Stateful, multiple methods, NestJS services/controllers |
| Code organization | Functions | Stateless, single purpose, functional style |
| Retry logic | Exponential backoff | Transient failures (5xx only) |
| Concurrency control | Semaphores | Bounded parallelism needed |
| Folder structure | Flat structure | Files < FOLDER_FLAT_THRESHOLD |
| Folder structure | Nested structure | Files >= FOLDER_FLAT_THRESHOLD |

## Preferred Paradigms

- Functional core, imperative shell: keep business logic pure and side-effect free; isolate I/O and mutation at boundaries.
- Composition over inheritance: prefer small composable functions and objects.
- Explicit effects: model async, errors, and external dependencies via parameters and Result/Option types, not hidden globals.
- Immutability by default: avoid shared mutable state; favor new values over in-place mutation.
- Pragmatic patterns: prefer simple GRASP/SOLID/GoF patterns (Adapter, Facade, Strategy) only when they clearly reduce coupling or clarify intent.

## Requirements

### Naming
- Classes: PascalCase (NestJS: suffix with Module/Controller/Service/Guard/Pipe/Interceptor)
- Variables/Functions: camelCase
- Files: kebab-case
- Constants: SCREAMING_SNAKE_CASE (include units)
- Environment Vars: UPPERCASE
- Booleans: Verb prefix (isX, hasX, canX)
- Abbreviations: i/j (loops), err, ctx, req/res
- English only

### Functions
- Length: <FUNCTION_MAX_LINES
- Refactor threshold: FUNCTION_REFACTOR_LINES
- Naming: Verb+noun
- Pattern: RO-RO for MAX_PARAMS_WITHOUT_RO_RO+ params/returns
- Nesting: ≤MAX_NESTING_DEPTH
- Single responsibility
- Extract at DUPLICATION_THRESHOLD
- Prefer pure; isolate side effects at boundaries

### TypeScript
- Strict mode always
- No `any` (create types)
- Magic numbers: Extract 2+ (0,1,-1 OK inline, use underscores: 10_000)
- Prefer focused modules: one primary export per file, allow related secondary exports when cohesion is high
- Use blank lines to separate logical blocks in functions; avoid excessive vertical whitespace
- JSDoc public classes/methods
- English only
- Branded: `type SessionId = string & { readonly __brand: 'SessionId' }`
- Discriminated unions: `{ status: 'success'; data: T } | { status: 'error'; error: string }`
- Union handling: Prefer exhaustive narrowing (`switch` + `never` guard) when consuming discriminated unions
- Conditional types: `type NonNullable<T> = T extends null | undefined ? never : T`
- Mapped: `Omit<User, 'id'>, Partial<Pick<User, 'name'>>`
- Satisfies: `const config = { ... } satisfies Config` (type-check without widening)
- DTOs: Declare near usage; share via `shared/types` when cross-module
- Types/Interfaces: Exported types in `*.types.ts` files; co-locate with implementation when single-module
- Import: Use `import type` for type-only imports
- Export: Use `export type` for type-only exports
- Prefer const objects over enums
- Path aliases: Use `baseUrl: "."` and `paths` in tsconfig.json (`@shared/*`, etc.)
- Config: strict: true, target: ES2022, module: CommonJS (NestJS default), moduleResolution: node

### Magic Numbers
- Extract 2+ (except 0,1,-1)
- Always extract 10+ (use underscores)
- Naming: Include units
- Organization: `src/shared/constants/` subfolder
- Exceptions: count === 0, index === -1, array[0], HTTP status in tests

### Magic Strings
- Extract repeated string literals (2+) when they represent protocol/domain meaning (headers, query keys, event names, error codes)
- Security-sensitive strings (auth header names, token prefixes, algorithm names) belong in shared constants, not inline
- Exceptions: single-use test fixtures and one-off switch labels with obvious local meaning

### Data
- Encapsulate in composite types
- Prefer immutability (`readonly`, `as const`)
- Avoid primitive obsession

### Classes
- SOLID
- Composition > Inheritance
- Interfaces for contracts
- Lines: <CLASS_MAX_LINES
- Methods: <CLASS_MAX_METHODS
- Properties: <CLASS_MAX_PROPERTIES
- Exceptions: Use for unexpected errors only

### Async
- Default: async/await
- Parallel: Promise.all() (independent) or Promise.allSettled() (partial failures)
- Sequential: for...of (dependent)
- Timeouts: AbortSignal (modern) or Promise.race()
- Concurrency: Semaphores for bounded parallelism
- Retry: Exponential backoff with jitter
- Never: async void, forEach with async, unbounded parallelism, no timeout

### Error Handling
- Expected: Result pattern `{ ok: true; value: T } | { ok: false; error: E }`
- Unexpected: Throw exceptions
- Hierarchy: Error → AppException → extend NestJS HttpException for HTTP errors
- HTTP: NOT_FOUND→404, INVALID_INPUT→400, UNAUTHORIZED→401, FORBIDDEN→403, INTERNAL_ERROR→500
- Logging: Always include traceId/requestId context. Never log passwords, tokens, API keys, session strings
- Severity: error (expected operational), fatal (unrecoverable), warn (degraded), info (recovered)
- Wrapping: Preserve original with `cause: err`, maintain stack trace
- Global handler: NestJS exception filters map errors to HTTP responses

### Testing

> No test runner is currently configured. Apply these conventions when Jest/Vitest is introduced.

- Pattern: AAA (Arrange/Act/Assert)
- Naming: inputX, mockX, actualX, expectedX
- Types: Unit (business logic), Integration (API endpoints), E2E (critical paths)
- Test Doubles: Mock (replace), Stub (predefined data), Spy (track calls), Fake (simplified impl)
- Avoid mocking third-party deps that are fast/cheap to execute

### Code Quality Tools
- ESLint + Prettier (configured in project)
- Workflow: After edits run `npm run lint`, `npm run format`, `npm run build`

### Dependency Hygiene
- Prefer existing utilities; add deps only when justified
- Modules side-effect free on import; expose factory functions

### Security Audit
- Align critical findings to OWASP ASVS v5.0 requirement IDs when applicable
- Validate and sanitize all untrusted input at boundaries (HTTP, env, external payloads)
- Prevent injection patterns: no dynamic command construction from untrusted input
- Disallow dynamic runtime code execution (`eval`, `new Function`) in app paths
- SSRF/open-redirect controls: allowlist outbound hosts/protocols and enforce request timeouts
- Logging hygiene: never log secrets, tokens, passwords, session strings, or raw credentials
- Supply-chain hygiene: audit dependencies regularly, avoid unreviewed lifecycle scripts

## Anti-Patterns

- Magic numbers 2+ without constants
- Magic strings 2+ without constants
- Constants without JSDoc comments
- Exported types/interfaces mixed with implementation (use `*.types.ts`)
- Type-only symbols imported without `import type`
- `any` types
- Functions >FUNCTION_MAX_LINES
- Multiple params without RO-RO (>MAX_PARAMS_WITHOUT_RO_RO)
- Nesting >MAX_NESTING_DEPTH
- Duplication >DUPLICATION_THRESHOLD without extraction
- Generic errors (`throw new Error('Failed')`)
- No error context
- async void
- forEach with async
- No timeout on async operations calling external services
- Retry terminal errors (400/401/404)
- Swallowing errors (`catch (err) { }`)
- Leaking stack traces to clients
- Logging sensitive data (session strings, API keys, tokens)
- `eval`/`new Function` or shell/SQL string concatenation with untrusted input
- Side effects in module imports
- Unbounded parallelism

## Output Expectations

- Updates: concise bullet lists (no post-task summary)
- Reference files/identifiers with backticks
- Call out assumptions, risks, required follow-up
