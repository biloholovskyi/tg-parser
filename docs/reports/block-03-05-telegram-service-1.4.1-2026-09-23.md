# Отчёт о завершении плана — block-03-05-telegram-service 1.4.1

- Компонент: `block-03-05-telegram-service`
- Версия: `1.4.1`
- Дата: 2026-09-23
- Ветка: `r-1.4.1`
- Тир сложности: `standard`
- План: [block-03-05-telegram-service-implementation-plan.md](../plans/block-03-05-telegram-service/block-03-05-telegram-service-implementation-plan.md)
- Риски: [risks.md](../plans/block-03-05-telegram-service/risks.md) · Research: [research.md](../plans/block-03-05-telegram-service/research.md) · Хронология: [history.md](../plans/block-03-05-telegram-service/history.md) · Reflect: [reflect.md](../plans/block-03-05-telegram-service/reflect.md)
- Аудит ресурсов: [block-03-05-resource-audit.md](../reviews/block-03-05-resource-audit.md)
- Аудит безопасности: [block-03-05-security-audit.md](../reviews/block-03-05-security-audit.md)
- Проверка дрейфа: [block-03-05-drift-audit.md](../reviews/block-03-05-drift-audit.md)

## Summary

У каждого клиента Telegram теперь есть потолок, срок жизни и путь освобождения: кэш `SessionClientCache` ограничен SESSION_CACHE_MAX_ENTRIES, простаивающие клиенты собираются в фоне, а вытеснение вызывает `destroy`. Ответ сервиса стал честным: выборка постов идёт страницами до POSTS_MAX_MESSAGES и помечает обрезку полем `isTruncated`, а отказы Telegram отражаются кодами 401, 404, 400, 429, 502, 503 вместо общего 500. Весь вывод идёт через `Logger` одной строкой исхода на запрос, без номеров телефонов и строк сессий.

## Phases

| Фаза | Статус | Доказательство |
|------|--------|----------------|
| [Phase 01 — жизненный цикл клиентов](../plans/block-03-05-telegram-service/phase-01-client-lifecycle.md) | done | Кэш вынесен в `src/telegram/utils/session-client-cache.ts` с потолком, фоновым сбором и `destroy` при вытеснении; явные опции GramJS, таймауты через `withTimeout`; гейты на момент фазы: lint и build чисто, `rtk npm test` — 262 теста, зелёные |
| [Phase 02 — выборка и коды ответов](../plans/block-03-05-telegram-service/phase-02-fetch-and-status-codes.md) | done | Постраничный обход по POSTS_PAGE_SIZE до POSTS_MAX_MESSAGES с `isTruncated`, сопоставление ошибок в `toHttpException`, неизвестная сессия — 401 вместо 400; гейты на момент фазы: lint и build чисто, `rtk npm test` — 345 тестов, `rtk npm run test:e2e` — 41 тест, зелёные |
| [Phase 03 — логирование](../plans/block-03-05-telegram-service/phase-03-logging.md) | done | Весь вывод `src/` через `Logger`, `no-console` в `.eslintrc.js` и тест `src/no-console.spec.ts`, одна строка исхода на запрос через `failWith`; гейты на момент фазы: lint и build чисто, `rtk npm test` — 378 тестов, зелёные |
| [Phase 04 — Finalize](../plans/block-03-05-telegram-service/phase-04-finalize.md) | done (этот закрывающий прогон) | post-code зелёный, три аудита выполнены, находки собственного кода блока исправлены с тестами, дымовой прогон на скомпилированном артефакте без реального аккаунта, документация и артефакты `docs/testing/` синхронизированы, версия `1.4.1` в CHANGELOG |

Замечание по факту: в файле `phase-04-finalize.md` на момент написания отчёта стоит статус `todo` и незакрытые пункты чеклиста — этот отчёт и строка в [индексе отчётов](README.md) являются последним пунктом того же чеклиста. Критерий приёмки «число живых клиентов не растёт после нескольких сессий» живым прогоном не подтверждён — см. раздел Test evidence.

Числа наборов тестов на момент фаз 01-03 в заметках фаз не записаны, поэтому приведено только число тестов.

## Affected files

База измерения — `HEAD` (`aa0176a`): изменения плана на момент отчёта не закоммичены, размеры взяты из `rtk git diff HEAD --stat`, выполненного при написании отчёта. Файлы, не добавленные в индекс git, в `diff --stat` не попадают — для них указано число строк (`wc -l`) с пометкой untracked.

Продуктовый код:

| Файл | Изменение, строк |
|------|------------------|
| `src/telegram/telegram.service.ts` | 559 |
| `src/telegram/utils/telegram-errors.ts` (новый) | 153 |
| `src/telegram/utils/session-client-cache.ts` (новый) | 107 |
| `src/telegram/constants.ts` (новый) | 89 |
| `src/telegram/utils/with-timeout.ts` (новый) | 22 |
| `src/config/telegram.config.ts` | 8 |
| `.eslintrc.js` | 8 |
| `src/shared/exceptions/too-many-requests.exception.ts` | 6 |
| `src/telegram/telegram.controller.ts` (только комментарий) | 3 |
| `src/telegram/interfaces/message.interface.ts` | 2 |

Тесты:

| Файл | Изменение, строк |
|------|------------------|
| `src/telegram/telegram.service.spec.ts` (новый) | 1471 |
| `src/telegram/utils/telegram-errors.spec.ts` (новый) | 682 |
| `src/telegram/utils/session-client-cache.spec.ts` (новый) | 286 |
| `src/config/telegram.config.spec.ts` | 102 |
| `src/telegram/utils/with-timeout.spec.ts` (новый) | 101 |
| `test/posts.e2e-spec.ts` | 82 |
| `src/no-console.spec.ts` (новый) | 43 |
| `test/app.e2e-spec.ts` | 21 |

Документация, версия и артефакты:

| Файл | Изменение, строк |
|------|------------------|
| `docs/testing/telegram-postman-collection.json` | 219 |
| `README.md` | 24 |
| `docs/testing/telegram-manual-testing.md` | 23 |
| `CLAUDE.md` | 14 |
| `.claude/rules/telegram.md` | 11 |
| `.claude/rules/architecture.md` | 10 |
| `.claude/rules/runtime-resources.md` | 7 |
| `CHANGELOG.md` | 3 |
| `.claude/rules/typescript.md` | 1 |

Суммарно по отслеживаемым путям окна: 36 файлов, 3895 добавленных и 317 удалённых строк. В это число входят также файлы самого плана (`docs/plans/block-03-05-telegram-service/*`, 110 строк) и память агентов (`.claude/agent-memory/*`, 45 строк) — они не являются ни кодом, ни документацией продукта.

Не попали в `diff --stat`, потому что не добавлены в индекс git:

| Файл | Строк (untracked) |
|------|-------------------|
| `docs/reviews/block-03-05-resource-audit.md` | 124 |
| `docs/reviews/block-03-05-security-audit.md` | 112 |
| `docs/reviews/block-03-05-drift-audit.md` | 77 |
| `.claude/agent-memory/resource-leak-auditor/reference_gramjs_defaults.md` | 16 (память агента) |
| `docs/plans/block-03-05-telegram-service/reflect.md` | создан вместе с этим отчётом |

## Test evidence

Итоговый прогон после исправлений Finalize:

- `rtk npm run lint` — чисто
- `rtk npm run build` — успешно
- `rtk npm test` — 23 набора, 443 теста, все прошли
- `rtk npm run test:e2e` — 3 набора, 41 тест, все прошли

Рост с 378 до 443 unit-тестов относительно Phase 03 пришёлся на Finalize, где исправлялись находки аудитов; разбивка прироста по находкам не измерялась.

Дымовой прогон на скомпилированном артефакте (`dist`, `PORT` 18080, подставной ключ API, без учётных данных Telegram). Наблюдаемые результаты:

- health — 200
- `/telegram/me` с подставной сессией — 200 `failed`
- выборка постов с подставной сессией — 401 с единым текстом недействительной сессии
- шаг 2 авторизации без конфигурации — 500
- в журнале по одной строке на запрос; подставной номер, подставная сессия и код не встречаются ни разу

Не проверено живьём — нужен реальный аккаунт Telegram, остаются открытыми ручными проверками для пользователя:

- реальная выборка постов за короткое и за длинное окно
- `isTruncated=true` на загруженном канале
- число живых клиентов остаётся ровным после обслуживания нескольких сессий (критерий приёмки Phase 04)

Не запускалось: `rtk npm run test:cov`, поэтому числа покрытия в отчёте не приводятся.

## API artifacts

Контракт ответов изменился для внешних потребителей:

- ответ выборки постов получил поле `isTruncated`
- неизвестная сессия на выборке постов — 401 (было 400)
- `/telegram/me` вместо `failed` может ответить 503 (сбой связи) или 429 (флуд-вейт)
- новые коды состояния: 404, 429, 502, 503

Артефакты ручного тестирования обновлены:

- [docs/testing/telegram-manual-testing.md](../testing/telegram-manual-testing.md) — случаи A7-A8 и E1-E14
- [docs/testing/telegram-postman-collection.json](../testing/telegram-postman-collection.json) — папка `telegram errors`

## Findings fixed during Finalize

Найдены [аудитом ресурсов](../reviews/block-03-05-resource-audit.md) (0 CRITICAL, 2 HIGH — оба существовали до плана, 5 MEDIUM, 4 LOW) и [аудитом безопасности](../reviews/block-03-05-security-audit.md) (1 CRITICAL и 1 HIGH — оба существовали до плана, 3 MEDIUM, 8 LOW) уже после Phase 03 и исправлены внутри Finalize:

- Ошибки MTProto классифицируются по точному коду, а не по подстроке сообщения: имя канала, которое GramJS включает в текст ошибки, могло подделать 401, 429 или 503 (security M1).
- `PHONE_NUMBER_FLOOD` и `PHONE_PASSWORD_FLOOD` отвечают 429 с PHONE_FLOOD_RETRY_AFTER_S (security M2).
- `PHONE_NUMBER_BANNED` получает тот же текст, что и недействительный номер (security L2).
- Неизвестная и отозванная сессии отвечают одинаковым 401 через `invalidSessionException`.
- Отозванная сессия удаляется и из файлового хранилища, чтобы не восстанавливаться и не переподключаться на каждом вызове (resource M-1).
- Логгер GramJS (`baseLogger`) переведён на уровень ERROR (resource M-2).
- Перезаписанный ожидающий авторизации клиент освобождается (resource M-3).
- Метка таймаута подключения вынесена в константу CONNECTION_LABEL (L8).

Дрейф документации по [проверке дрейфа](../reviews/block-03-05-drift-audit.md) исправлен в `CLAUDE.md` и `.claude/rules/` (`architecture.md`, `runtime-resources.md`, `telegram.md`, `typescript.md`).

## Problems and tech debt

Источники: [reflect.md](../plans/block-03-05-telegram-service/reflect.md), заметки фаз в [history.md](../plans/block-03-05-telegram-service/history.md) и отчёты аудитов.

Открытые решения:

- Файловое хранилище сессий пишет номера и строки сессий в `data/` — Known Deviation из `.claude/rules/telegram.md`, решается в блоке 08-09 (security C1, resource H-2).
- Карта состояний авторизации имеет TTL, но не имеет потолка размера (security H-1).
- 429, порождённый сервисом, не ставит заголовок `Retry-After`; ожидание передаётся только в теле (`retryAfterSeconds`).

Технический долг:

- Нет общего срока на запрос выборки постов: обход может занять до ~13 × EXTERNAL_CALL_TIMEOUT_MS (resource M-4).
- Обработчик `uncaughtException` завершает процесс (resource M-5, существовало до плана).
- Неверный код или пароль уничтожает ожидающую авторизацию (security M3).
- Проверка конфигурации только на пути авторизации: без учётных данных пути сессий отвечают 502/503 вместо 500 (security L4).
- `authenticate()` далеко за пределом длины функции (security L5) — структурный распил запланирован в блоке 08-09.
- LRU может вытеснить клиента посреди обхода выборки (resource L-2).
- Двойное освобождение при сбое подключения на шаге 1 авторизации (resource L-3, безвредно).
- На момент Phase 02 тестами не были покрыты медиа-ветки `parseMessage`, восстановление из `data/*.json` и ответ `needsPassword`; после Finalize это не перепроверялось.

Ручные проверки для пользователя (реальный аккаунт): перечислены в разделе Test evidence.
