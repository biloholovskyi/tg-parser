# Отчёт о завершении плана — block-08-09-refactor-strictness-storage 1.4.1

- Компонент: `block-08-09-refactor-strictness-storage`
- Версия: `1.4.1`
- Дата: 2026-09-24
- Ветка: `r-1.4.1`
- Тир сложности: `standard`
- План: [block-08-09-refactor-strictness-storage-implementation-plan.md](../plans/block-08-09-refactor-strictness-storage/block-08-09-refactor-strictness-storage-implementation-plan.md)
- Решение: [adr-session-storage.md](../plans/block-08-09-refactor-strictness-storage/adr-session-storage.md) · Замысел: [design.md](../plans/block-08-09-refactor-strictness-storage/design.md) · Риски: [risks.md](../plans/block-08-09-refactor-strictness-storage/risks.md) · Research: [research.md](../plans/block-08-09-refactor-strictness-storage/research.md)
- Аудит безопасности: [block-08-09-security-audit.md](../reviews/block-08-09-security-audit.md)
- Аудит ресурсов: [block-08-09-resource-audit.md](../reviews/block-08-09-resource-audit.md)
- Проверка дрейфа: [block-08-09-drift-audit.md](../reviews/block-08-09-drift-audit.md)

В папке плана нет `history.md` и `reflect.md`; отчёт собран по индексу плана, файлам фаз, ADR, отчётам аудитов, фактам от вызывающей стороны и прогонам, выполненным при написании отчёта.

## Summary

Открытая развилка по хранению сессий закрыта решением пользователя «только память», зафиксированным в ADR: файловое хранилище (`data/*.json`, синхронный ввод-вывод) удалено, правила, `CLAUDE.md`, `README.md` и `DEPLOYMENT.md` приведены к этой модели. `TelegramService` разделён на фасад и отдельные единицы — `AuthService`, `ChannelService`, `SessionStore` (единственный владелец жизненного цикла клиента), `TelegramClientFactory` (единственное место создания `TelegramClient`) и чистый преобразователь `utils/message.mapper.ts`. Компилятор работает с `strictNullChecks`, `noImplicitAny` и `strictBindCallApply`.

## Phases

| Фаза | Статус | Доказательство |
|------|--------|----------------|
| [Phase 01 — решение по хранилищу](../plans/block-08-09-refactor-strictness-storage/phase-01-storage-decision.md) | done | ADR принят пользователем (вариант «только память»); файловые методы и синхронный `fs` удалены — аудит безопасности подтверждает, что ни один продуктовый файл `src/` не импортирует `fs`; Known Deviations в `.claude/rules/telegram.md` закрыт, `CLAUDE.md`, `README.md`, `DEPLOYMENT.md` обновлены |
| [Phase 02 — распил сервиса](../plans/block-08-09-refactor-strictness-storage/phase-02-service-split.md) | done | Созданы `auth.service.ts`, `channel.service.ts`, `session-store.ts`, `telegram-client.factory.ts`, `utils/message.mapper.ts` со своими спек-файлами; помощник `failWith` в `telegram-errors.ts`; удалены неиспользуемые `TelegramMedia.url` и `TelegramService.disconnect`; новые константы PASSWORD_NEEDED_ERROR, POST_URL_BASE |
| [Phase 03 — строгость TypeScript](../plans/block-08-09-refactor-strictness-storage/phase-03-typescript-strictness.md) | done | В `tsconfig.json` включены `strictNullChecks`, `noImplicitAny`, `strictBindCallApply`; ошибки типов в спек-файлах исправлены сужением; `rtk npm run typecheck` при написании отчёта — без ошибок |
| [Phase 04 — Finalize](../plans/block-08-09-refactor-strictness-storage/phase-04-finalize.md) | done (этот закрывающий прогон), кроме дымового прогона | Три аудита выполнены, 0 CRITICAL; найденная аудитами гонка владения ожидающим входом исправлена с регрессионными тестами; дрейф документации исправлен; версия `1.4.1` в `package.json` и CHANGELOG; дымовой прогон с реальным Telegram не выполнен |

Замечание по факту: в файлах всех четырёх фаз на момент написания отчёта стоит `Статус: todo` и незакрытые чеклисты, хотя индекс плана отмечает Phase 01-03 как `done`, а Phase 04 — `in progress`. Статусы в таблице взяты из индекса плана и фактов вызывающей стороны. Этот отчёт и строка в [индексе отчётов](README.md) — последний пункт чеклиста Phase 04.

Числа тестов на момент каждой из фаз 01-03 не записаны ни в файлах фаз, ни в `history.md` (его нет), поэтому в таблице они не приводятся.

## Affected files

База измерения — `HEAD` (`7cca4fb`): изменения плана не закоммичены, размеры взяты из `rtk git diff HEAD --stat`, выполненного при написании отчёта. Файлы, не добавленные в индекс git, в `diff --stat` не попадают — для них указано число строк (`wc -l`) с пометкой untracked.

Продуктовый код:

| Файл | Изменение, строк |
|------|------------------|
| `src/telegram/telegram.service.ts` | 598 (в основном удаление: стал фасадом) |
| `src/telegram/auth.service.ts` (новый, untracked) | 213 |
| `src/telegram/channel.service.ts` (новый, untracked) | 123 |
| `src/telegram/session-store.ts` (новый, untracked) | 88 |
| `src/telegram/telegram-client.factory.ts` (новый, untracked) | 57 |
| `src/telegram/utils/message.mapper.ts` (новый, untracked) | 31 |
| `src/telegram/utils/telegram-errors.ts` | 17 |
| `src/telegram/interfaces/auth-result.interface.ts` (новый, untracked) | 7 |
| `src/telegram/telegram.module.ts` | 8 |
| `src/telegram/constants.ts` | 6 |
| `tsconfig.json` | 6 |
| `src/shared/utils/process-handlers.ts` | 5 |
| `src/telegram/interfaces/message.interface.ts` | 1 |

Тесты:

| Файл | Изменение, строк |
|------|------------------|
| `src/telegram/telegram.service.spec.ts` | 646 |
| `src/telegram/session-store.spec.ts` (новый, untracked) | 378 |
| `src/telegram/telegram-client.factory.spec.ts` (новый, untracked) | 215 |
| `src/telegram/utils/message.mapper.spec.ts` (новый, untracked) | 106 |
| `src/telegram/utils/telegram-errors.spec.ts` | 91 |
| `test/no-network.e2e-spec.ts` | 48 |
| `test/lifecycle-providers.ts` (новый, untracked) | 14 |
| `src/telegram/dto/auth.dto.spec.ts` | 12 |
| `src/telegram/dto/messages.dto.spec.ts` | 12 |
| `src/telegram/telegram.controller.spec.ts` | 10 |
| `test/app.e2e-spec.ts` | 8 |
| `test/auth.e2e-spec.ts` | 8 |
| `test/posts.e2e-spec.ts` | 8 |
| `src/telegram/utils/with-timeout.spec.ts` | 2 |

Документация, правила и версия:

| Файл | Изменение, строк |
|------|------------------|
| `CLAUDE.md` | 13 |
| `.claude/rules/architecture.md` | 13 |
| `.claude/rules/typescript.md` | 12 |
| `.claude/rules/telegram.md` | 11 |
| `README.md` | 10 |
| `.claude/agents/code-reviewer.md` | 4 |
| `CHANGELOG.md` | 3 |
| `DEPLOYMENT.md` | 2 |
| `.claude/rules/core-rules.md` | 2 |
| `.claude/rules/drift-audit.md` | 2 |
| `.claude/rules/patterns.md` | 2 |
| `.claude/skills/typecheck/SKILL.md` | 2 |
| `.claude/agents/codebase-researcher.md` | 2 |
| `.claude/agents/tg-parser-backend-expert.md` | 2 |

Суммарно по отслеживаемым путям окна: 36 файлов, 597 добавленных и 1022 удалённых строки. В это число входят также индекс плана (`docs/plans/block-08-09-refactor-strictness-storage/*`, 10 строк) и память агентов (`.claude/agent-memory/*`, 43 строки) — они не являются ни кодом, ни документацией продукта.

Прочие untracked-файлы окна:

| Файл | Строк (untracked) |
|------|-------------------|
| `docs/reviews/block-08-09-resource-audit.md` | 115 |
| `docs/reviews/block-08-09-security-audit.md` | 92 |
| `docs/reviews/block-08-09-drift-audit.md` | 77 |
| `docs/plans/block-08-09-refactor-strictness-storage/adr-session-storage.md` | 26 |

## Test evidence

Прогоны, выполненные при написании этого отчёта (после исправлений Finalize):

- `rtk npm test` — 27 наборов, 539 тестов, все прошли
- `rtk npm run test:e2e` — 4 набора, 49 тестов, все прошли
- `rtk npm run typecheck` — без ошибок

Вызывающая сторона сообщила о зелёных `rtk npm run lint` и `rtk npm run build` в рамках post-code Finalize; при написании отчёта они повторно не запускались (`lint` работает с автоисправлением и изменил бы файлы).

Не запускалось: `rtk npm run test:cov`, поэтому числа покрытия в отчёте не приводятся.

Не проверено живьём — нужен реальный аккаунт Telegram, остаётся ручной проверкой для пользователя:

- дымовой прогон: полный цикл авторизации (телефон, код, при необходимости 2FA) и выборка постов на поднятом сервисе после распила — пункт чеклиста и критерий приёмки Phase 04
- поведение после перезапуска: прежняя строка сессии получает 401 на выборке постов и `failed` на `/telegram/me`

## API artifacts

Маршруты и их контракт не менялись: поведение эндпоинтов после распила то же. Удалённое поле `TelegramMedia.url` было необязательным и в исходном `telegram.service.ts` не заполнялось, поэтому форма фактического ответа не изменилась. Видимое для потребителя следствие ADR — после перезапуска или выката нужна повторная авторизация — фактически существовало и раньше из-за эфемерного диска.

Артефакты [docs/testing/telegram-manual-testing.md](../testing/telegram-manual-testing.md) и [docs/testing/telegram-postman-collection.json](../testing/telegram-postman-collection.json) в этом плане не менялись.

## Findings fixed during Finalize

- Гонка владения ожидающим входом в `AuthService` (аудит ресурсов M-A, аудит безопасности M1): при параллельных запросах на один номер `completeLogin` мог удалить чужую запись без освобождения клиента, а упавший шаг — уничтожить свежий клиент другого запроса. Исправлено: `completeLogin` забирает своё состояние до `adopt`, упавшие шаги освобождают только собственный клиент. Регрессионные тесты добавлены.
- Дрейф документации по [проверке дрейфа](../reviews/block-08-09-drift-audit.md) исправлен в `README.md`, `.claude/rules/architecture.md`, `.claude/rules/patterns.md`, `.claude/rules/typescript.md`. Пункт 6 отчёта дрейфа (`.claude/skills/typecheck/SKILL.md`) в самом отчёте помечен как неисправленный, но на момент написания этого отчёта файл уже описывает включённый режим компилятора.

По аудиту ресурсов закрыты прежние находки H-2 (файловое хранилище), M-1, L-1, L-3. Аудит безопасности снял CRITICAL, переносившийся с блока 01 (учётные данные на диске).

## Problems and tech debt

Источники: отчёты аудитов и факты вызывающей стороны; `reflect.md` в папке плана нет.

Открытые находки аудитов:

- H1 / H-1: карта ожидающих входов в `AuthService` имеет TTL, но не имеет потолка размера; ключ — необработанный номер, тогда как ограничитель по телефону нормализует его до цифр.
- M2 (безопасность): вытесненные сессии уничтожаются локально, но не завершаются на стороне Telegram (`auth.LogOut` не вызывается) — выданная строка сессии остаётся действующей авторизацией аккаунта. Нужно исправить или записать как принятый риск с решением пользователя.
- M-4: нет общего срока на запрос выборки постов, только отдельные таймауты на каждый вызов.
- M-5: `uncaughtException` завершает процесс, а с ним все сессии и ожидающие входы.
- M3 (безопасность): уязвимости зависимостей по `rtk npm audit`; исправление для рантайма требует мажорного обновления `@nestjs/platform-express`.
- L-B: GramJS при сбое пинга печатает стек в консоль в обход `Logger`.
- L-A, L-C, L-D, L-2, L-4 (ресурсы) — низкий приоритет, подробности в [аудите ресурсов](../reviews/block-08-09-resource-audit.md).

Прочее:

- Сообщения хука `.claude/hooks/guard-secrets.js` всё ещё ссылаются на прежнее отклонение с `data/` (Known Deviations); хук не правился, так как это конфигурация пользователя.
- Статусы и чеклисты в файлах фаз не обновлены (см. замечание под таблицей Phases).
- Дымовой прогон с реальным аккаунтом не выполнен — см. Test evidence.
