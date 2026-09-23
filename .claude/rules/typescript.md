---
paths:
  - "src/**/*.ts"
  - "test/**/*.ts"
  - "tsconfig.json"
---
# tg-parser TypeScript

Project-specific TypeScript config and decorator usage.

## Compiler Config (actual)

- Target: ES2021
- Module: CommonJS (NestJS default)
- Decorators enabled: `emitDecoratorMetadata: true`, `experimentalDecorators: true`
- `esModuleInterop: true`, `allowSyntheticDefaultImports: true`, `skipLibCheck: true`
- `strictNullChecks: false`, `noImplicitAny: false`, `strictBindCallApply: false`, `forceConsistentCasingInFileNames: false`
- No path aliases are configured; imports are relative
- ESLint: `no-console` is an error for `src/**/*.ts` except `*.spec.ts` (override in `.eslintrc.js`), backed by the scan in `src/no-console.spec.ts`

## Known Gaps

The compiler is permissive and ESLint disables `@typescript-eslint/no-explicit-any`. Treat that as legacy tolerance, not as permission:

- Write new code as if `strictNullChecks` and `noImplicitAny` were on: annotate parameters and return types, handle `null`/`undefined` explicitly.
- Do not introduce new `any`. Use `unknown` plus narrowing when a third-party shape is genuinely unknown (GramJS results often are).
- Tightening `tsconfig.json` or the ESLint rules is a deliberate, user-approved change with its own plan — not a drive-by edit inside an unrelated task.
- Adding a `@/*` path alias is likewise a user-approved change; until then, relative imports are correct and consistent.

## Type System Rules

- Prefer `import type` for type-only imports
- Prefer `as const` objects over TypeScript `enum`
- Use `satisfies` to type-check without widening
- Discriminated unions for multi-shape results, for example the multi-step auth response
- Branded types for opaque domain strings when type safety warrants it, for example a session string
- Response shapes live in `interfaces/`; request shapes live in `dto/` as classes with `class-validator`
- GramJS return values are narrowed at the service boundary; untyped MTProto objects never reach the controller

## Decorator Cheatsheet

| Decorator | Source | Usage |
|-----------|--------|-------|
| `@Module()` | `@nestjs/common` | All modules |
| `@Injectable()` | `@nestjs/common` | Services and any DI-provided class |
| `@Controller('route')` | `@nestjs/common` | REST controllers |
| `@Get() / @Post() / @Put() / @Patch() / @Delete()` | `@nestjs/common` | REST routes |
| `@Body() / @Param() / @Query()` | `@nestjs/common` | REST param extraction |
| `@IsString() / @IsNotEmpty() / @IsOptional() / @IsEnum() / @IsInt() / @IsDateString()` | `class-validator` | Input validation on request DTOs |

## Validation

- All request DTOs use `class-validator` decorators.
- Enforcement depends on the global `ValidationPipe` built in `src/shared/utils/http-pipeline.ts` and applied from `src/main.ts`; confirm it is registered before relying on DTO validation for a new endpoint.
- Never accept unvalidated external input into the service layer.

## Anti-Patterns

- New `any` types (use `unknown` plus narrowing)
- Implicit `any` parameters, relied on because the compiler allows it
- Unchecked nullable access, relied on because `strictNullChecks` is off
- TypeScript `enum` in new code
- Missing `class-validator` decorators on request DTOs
- `console.log` in committed code (use the NestJS `Logger`)
- Silently changing `tsconfig.json` strictness as part of an unrelated task

## Related Rules

- `.claude/rules/patterns.md` — patterns and limits
- `.claude/rules/architecture.md` — module and decorator usage
- `.claude/rules/telegram.md` — narrowing GramJS results
