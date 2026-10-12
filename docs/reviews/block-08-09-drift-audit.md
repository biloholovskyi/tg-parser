# Drift Audit — block-08-09-refactor-strictness-storage — 2026-09-24

Scope: uncommitted changes of `docs/plans/block-08-09-refactor-strictness-storage/` checked against `CLAUDE.md`,
`.claude/rules/*.md`, `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`, `README.md`, `DEPLOYMENT.md`, the ADR
`docs/plans/block-08-09-refactor-strictness-storage/adr-session-storage.md` and `.claude/hooks/guard-secrets.js`.
Process: `.claude/rules/drift-audit.md`.
Classes: A = doc wrong, code right; B = code wrong, rule right; C = open decision.

## Drift found

1. README states the code still writes session strings to `data/`.
   Doc: `README.md:260` (before fix).
   Code: `src/telegram/session-store.ts:16-88` and `src/telegram/auth.service.ts:19-190` hold sessions and pending logins in memory only; no `fs` import anywhere in non-spec `src/` (grep `fs|writeFile|readFile|mkdir`).
   Class A. Fixed: README now states memory-only, re-auth after restart or deploy.

2. README architecture tree describes `telegram.service.ts` as "Бизнес-логика (GramJS)" and omits the new files.
   Doc: `README.md:229-232` (before fix).
   Code: `src/telegram/telegram.service.ts:13-71` is a facade that imports no `TelegramClient`; GramJS work sits in `auth.service.ts`, `channel.service.ts`, `session-store.ts`, `telegram-client.factory.ts`, `utils/message.mapper.ts`.
   Class A. Fixed: tree lists the facade and the four new files, `utils/` mentions the mapper.

3. Module template says "all GramJS calls live" in `*.service.ts`.
   Doc: `.claude/rules/architecture.md:22`.
   Code: `src/telegram/session-store.ts:36,58,78` (`connect`, `destroy`) and `src/telegram/telegram-client.factory.ts:38` (construction) are not `*.service.ts`; the same rule's Dependency Injection section already names them.
   Class A. Fixed: GramJS calls stay in the module's services and client-lifecycle classes (`SessionStore`, `TelegramClientFactory`).

4. "Write to strict semantics even though the compiler is permissive".
   Doc: `.claude/rules/patterns.md:111`.
   Code: `tsconfig.json:15-17` (`strictNullChecks`, `noImplicitAny`, `strictBindCallApply` all true).
   Class A. Fixed: the compiler enforces `strictNullChecks` and `noImplicitAny`.

5. Anti-pattern "Implicit `any` parameters, relied on because the compiler allows it".
   Doc: `.claude/rules/typescript.md:60`.
   Code: `tsconfig.json:16` (`noImplicitAny: true`), so the compiler no longer allows it.
   Class A. Fixed: reworded to escaping `noImplicitAny` with an explicit `any` or `as any`.

6. `/typecheck` skill says the compiler is permissive (`strictNullChecks: false`, `noImplicitAny: false`).
   Doc: `.claude/skills/typecheck/SKILL.md:12`.
   Code: `tsconfig.json:15-16`.
   Class A. Not edited (skills are outside the edit scope of this run). Proposed text: "The compiler runs with `strictNullChecks` and `noImplicitAny`; `strictPropertyInitialization` and the rest of `strict` are off, so still call out risky non-null assertions in changed code."

7. DEPLOYMENT.md says the code writes session strings to `data/` and a container restart may restore a session from that file; calls it an open deviation.
   Doc: `DEPLOYMENT.md:62`.
   Code: `src/telegram/session-store.ts:17-18` (memory only; a session with no cached client is unknown), no filesystem access in `src/`.
   Class A. Not edited (outside the edit scope of this run). Proposed text: "Кэш клиентов Telegram и незавершённые входы живут только в памяти процесса, на диск ничего не пишется. Любой перезапуск или деплой сбрасывает сессии — нужно авторизоваться заново."

8. Secret guard hook messages describe `data/` as holding live runtime state and point to "Known Deviations".
   Doc: `.claude/hooks/guard-secrets.js:18,50-57`.
   Code: nothing is written under `data/` (see 1); `.claude/rules/telegram.md:34` now states no open deviation.
   Class A for the message text only. The blocks themselves remain valid defence (`data/` stays git-ignored, `.gitignore:44`). Not edited (hook code, outside scope). Proposed: reword line 18 to "data/ is git-ignored and must not be written from a tool call; sessions are memory-only (ADR adr-session-storage.md)"; the `sessions.json` / `auth-states.json` read patterns may be kept or dropped by user choice.

9. `test-writer` agent memory describes the file-backed store as current.
   Doc: `.claude/agent-memory/test-writer/project_test_setup_gotchas.md:52-56,79` (`new TelegramService()` with no DI, `fs` mock to keep the file-backed store off `data/`).
   Code: `src/telegram/telegram.service.ts:21-25` now needs `AuthService`, `ChannelService`, `SessionStore`; no file store exists.
   Class A. Not edited (another agent's memory). Proposed: the `test-writer` agent prunes items 8 and 13 on its next run.

## Observed, not drift

- Architecture arrow `TelegramService → AuthService | ChannelService → SessionStore` (`CLAUDE.md:39`, `.claude/rules/architecture.md:14`) is accurate for auth and posts; `checkSession` goes from the facade to `SessionStore` directly (`src/telegram/telegram.service.ts:54`). Simplification, not a contradiction; no edit.
- `src/telegram/telegram.service.spec.ts` contained file-store tests (`file-store failures never break the operation`, data-directory creation) early in this audit and no longer did at the end; the file was being edited concurrently. Final state: no file-store assertions remain, the `fs` spies only back the memory-only proof (`:629`).

## Verified accurate

- Session model: `CLAUDE.md:5,49`, `.claude/rules/architecture.md` Session Model, `.claude/rules/telegram.md:15-16,34` against `src/telegram/session-store.ts` (cache owner, `adopt`, `getConnected`, `release` via `destroy`) and `src/telegram/auth.service.ts` (pending logins in a `Map`, TTL sweep, `unref`).
- ADR decision and consequences: memory only, nothing under `data/`; restart gives 401 on posts (`session-store.ts:55`), `failed` on `/me` (`telegram.service.ts:63-68`), and 400 on the code step after restart (`auth.service.ts:106-107`, passed through by `toHttpException`, `utils/telegram-errors.ts:121-123`).
- Key source file list and descriptions in `CLAUDE.md:53-72`: every path exists; `telegram-client.factory.ts` is the only `new TelegramClient` (`:38`); `message.mapper.ts` is pure.
- Dependency injection claim (`.claude/rules/architecture.md` DI section): providers in `src/telegram/telegram.module.ts:15-20`.
- Runtime constants (`.claude/rules/runtime-resources.md` Constants): every value matches `src/telegram/constants.ts:2-46`; client options match `telegram-client.factory.ts:39-45`.
- Error mapping table (`.claude/rules/telegram.md`) against `toHttpException` (`utils/telegram-errors.ts:120-142`) and `missingConfigException` (`:153`, raised from `auth.service.ts:55-57`).
- TypeScript config (`.claude/rules/typescript.md:13-19`, `.claude/rules/core-rules.md:93`, agents `code-reviewer.md:17`, `tg-parser-backend-expert.md:19`) against `tsconfig.json`; ESLint claims against `.eslintrc.js:23,30`.
- Agent descriptions of cache ownership (`code-reviewer.md`, `codebase-researcher.md`) against `session-store.ts`.
- REST surface against `src/telegram/telegram.controller.ts` (4 routes, headers, `@PublicRoute` on health only).
- API security constants against `src/shared/constants/http.constants.ts` and `rate-limit.constants.ts` (headers, 60/min, 5/h, 16 KB).
- Environment variables: reads in `src/config/*.ts` and `src/main.ts:28` match the `CLAUDE.md` table.
- Deployment: `railway.toml` (RAILPACK, `npm run start:prod`, `/telegram/health`, port 8080) against `src/main.ts` and `DEFAULT_PORT`.
- Scripts named in rules and skills exist in `package.json`.
- Inventories: 15 agents and 15 skills on disk match `CLAUDE.md` and `.claude/rules/index.md`.
- Version gates: branch `r-1.4.1`, `package.json` `1.4.1`, top `CHANGELOG.md` header `[1.4.1] 24.09.2026` (today), top three bullets describe this plan. Pass.
