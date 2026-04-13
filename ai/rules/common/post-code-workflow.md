# Post-Code Workflow

Mandatory quality checks after code changes.

## Required Steps (In Order)

1. Lint: `npm run lint` — ESLint with auto-fix; fix manually on failure
2. Format: `npm run format` — Prettier; rerun lint if conflicts arise
3. Build: `npm run build` — TypeScript compile via `nest build`; fix type errors on failure

## One-Line Workflow

```bash
npm run lint && npm run format && npm run build
```

## Pre-Commit Checklist

- [ ] Lint passes (`npm run lint`)
- [ ] Build passes (`npm run build`)
- [ ] No `console.log` left (use NestJS Logger)
- [ ] No `TODO` comments
- [ ] No secrets or credentials in code
- [ ] Documentation updated (if API/endpoint changed)

## Common Issues

Lint errors:
- Run `npm run lint` — it auto-fixes most issues
- Remaining: manual fix of ESLint violations

Prettier conflicts:
- Run `npm run format` — reformats all `src/**/*.ts`
- If lint still fails after format, re-run `npm run lint`

TypeScript errors:
- Run `npm run build` to see full compiler output
- Fix type errors in source, not by suppressing with `// @ts-ignore`
- Check `tsconfig.json` if module resolution errors appear

## Quality Gates

- Lint: < 10s
- Build: < 30s

## IDE Setup (VS Code)

ESLint + Prettier:
- `editor.formatOnSave: true`
- `editor.defaultFormatter: "esbenp.prettier-vscode"` for TypeScript
- `editor.codeActionsOnSave: { "source.fixAll.eslint": true }`

See `ai/rules/common/patterns.md` and `ai/rules/common/core-rules.md`.
