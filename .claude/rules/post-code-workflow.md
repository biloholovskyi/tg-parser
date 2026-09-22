---
paths:
  - "src/**/*"
  - "test/**/*"
  - "package.json"
---
# Post-Code Workflow

Mandatory quality checks after any code change. Stop at the first error; fix before the next step.

## Required Steps (In Order)

1. `rtk npm run lint` — ESLint auto-fix; fix all remaining errors before continuing
2. `rtk npm run build` — compile TypeScript
3. `rtk npm test` — Jest unit tests

## One-Line Workflow

- `rtk npm run lint && rtk npm run build && rtk npm test`

## Pre-Commit Checklist

- [ ] Lint passes (ESLint auto-fix applied)
- [ ] Build passes (TypeScript compiles)
- [ ] Tests pass (Jest unit tests)
- [ ] New or changed functionality has tests (`.claude/rules/testing.md`)
- [ ] No `console.log` left in production code (use the NestJS `Logger`)
- [ ] No session string, API hash, phone number, or code reachable by a log statement (`.claude/rules/telegram.md`)
- [ ] No credential in a URL, path, or query string (`.claude/rules/api-security.md`)
- [ ] Every new cache entry has a ceiling and an eviction path; every created client has a disconnect path; every timer is cleared (`.claude/rules/runtime-resources.md`)
- [ ] No synchronous filesystem call added on a request path
- [ ] New or changed endpoint has caller authentication and a rate limit (`.claude/rules/api-security.md`)
- [ ] Rules and `CLAUDE.md` still describe what the code does (`.claude/rules/drift-audit.md`)
- [ ] No `TODO` comments without an owner or issue reference
- [ ] REST endpoints or response contracts created or changed: manual test artifacts in `docs/testing/` are current (`.claude/rules/api-contracts.md`)
- [ ] New env vars documented in `CLAUDE.md` and read through `src/config/`

## Common Issues

Lint errors:
- Run `rtk npm run lint` (auto-fix) first; group remaining errors by file
- Optional: `rtk npm run format` (Prettier)

Build errors:
- Decorator metadata missing: ensure `emitDecoratorMetadata` and `experimentalDecorators` in `tsconfig.json`
- GramJS type mismatch: narrow the MTProto result at the service boundary instead of casting to `any`

Test failures:
- Update the test or fix the implementation — never skip the test
- For GramJS-dependent tests: mock the client, never connect for real
- Check path issues (Windows vs Unix separators)

## Quality Gates

Coverage targets (when coverage is measured):
- Unit >= 80%
- Integration >= 70%

Performance:
- Lint <10s
- Build <30s
- Unit tests <60s

## Commands Reference

- `rtk npm run lint` — ESLint auto-fix
- `rtk npm run format` — Prettier
- `rtk npm run build` — compile TypeScript
- `rtk npm run typecheck` — type-only check
- `rtk npm test` — unit tests (Jest)
- `rtk npm run test:cov` — unit tests with coverage
- `rtk npm run test:e2e` — E2E tests
- `rtk npm run start:dev` — dev server with watch mode

See `.claude/rules/core-rules.md` and `.claude/rules/patterns.md`.
