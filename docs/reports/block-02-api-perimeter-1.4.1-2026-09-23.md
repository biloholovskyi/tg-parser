# Отчёт о завершении плана — block-02-api-perimeter 1.4.1

- Компонент: `block-02-api-perimeter`
- Версия: `1.4.1`
- Дата: 2026-09-23
- Ветка: `r-1.4.0`
- Тир сложности: `standard`
- План: [block-02-api-perimeter-implementation-plan.md](../plans/block-02-api-perimeter/block-02-api-perimeter-implementation-plan.md)
- Риски: [risks.md](../plans/block-02-api-perimeter/risks.md) · Research: [research.md](../plans/block-02-api-perimeter/research.md) · Хронология: [history.md](../plans/block-02-api-perimeter/history.md)
- Аудит безопасности: [security-audit-2026-09-23.md](../reviews/security-audit-2026-09-23.md)
- Проверка дрейфа: [drift-audit-2026-09-23.md](../reviews/drift-audit-2026-09-23.md)

## Summary

Ни один маршрут, кроме health-проверки, больше не выполняется без ключа вызывающей стороны: `ApiKeyGuard`, `RateLimitGuard` и `PhoneRateLimitGuard` зарегистрированы как `APP_GUARD` и покрывают весь набор маршрутов, а пустой `API_KEYS` закрывает сервис, а не открывает его. Стоимость обращений к Telegram ограничена двумя счётчиками — общим по ключу и отдельным по номеру телефона на маршруте авторизации, — а превышение отдаёт 429 с `Retry-After`. Строка сессии переведена из строки запроса в заголовок `x-session-string`, форма каждого запроса описана DTO, и попытка передать `sessionString` в query отклоняется с 400.

## Phases

| Фаза | Статус | Доказательство |
|------|--------|----------------|
| [Phase 01 — ключ доступа и гвард](../plans/block-02-api-perimeter/phase-01-api-key-guard.md) | done | `ApiKeyGuard` сверяет `x-api-key` со списком ключей в постоянном времени и отдаёт единый `UNAUTHORIZED_MESSAGE`; health помечен `@PublicRoute()`, сравнения по строке пути нет; гейты на момент фазы: lint и build чисто, `rtk npm test` — 10 наборов, 111 тестов, зелёные |
| [Phase 02 — рейт-лимиты](../plans/block-02-api-perimeter/phase-02-rate-limits.md) | done | Общий лимит по значению `x-api-key` и лимит авторизации по номеру телефона, субъект хранится дайджестом, ограничители ничего не пишут в лог; гейты на момент фазы: lint и build чисто, `rtk npm test` — 16 наборов, 168 тестов, зелёные |
| [Phase 03 — транспорт строки сессии и DTO](../plans/block-02-api-perimeter/phase-03-session-transport-dto.md) | done | `SESSION_HEADER` читается хелпером `readSessionHeader` и декоратором `@SessionString()`; `GetPostsDto` заменён на `ChannelPostsParamsDto` и `GetPostsQueryDto`, артефакты `docs/testing/` обновлены; гейты на момент фазы: lint и build чисто, `rtk npm test` — 18 наборов, 199 тестов, `rtk npm run test:e2e` — 3 набора, 36 тестов, зелёные |
| [Phase 04 — Finalize](../plans/block-02-api-perimeter/phase-04-finalize.md) | done (этот закрывающий прогон) | post-code зелёный, аудит безопасности и проверка дрейфа выполнены, два дефекта собственного кода блока исправлены с тестами, дымовой прогон на скомпилированном артефакте выполнен дважды, документация и артефакты `docs/testing/` синхронизированы, версия `1.4.1` и CHANGELOG проставлены |

Замечание по факту: в файле `phase-04-finalize.md` на момент написания отчёта стоит статус `todo` и незакрытые пункты чеклиста — этот отчёт и строка в [индексе отчётов](README.md) являются последним пунктом того же чеклиста и закрываются вместе с ним.

## Affected files

База измерения — `HEAD` (`926e887`): изменения плана на момент отчёта не закоммичены, размеры взяты из `rtk git diff HEAD --stat`, выполненного при написании отчёта. Файлы, не добавленные в индекс git, в `diff --stat` не попадают — для них указано число строк (`wc -l`) с пометкой untracked.

Периметр — новый продуктовый код:

| Файл | Изменение, строк |
|------|------------------|
| `src/config/api-keys.config.ts` (новый) | 35 |
| `src/shared/constants/rate-limit.constants.ts` (новый) | 16 |
| `src/shared/guards/api-key.guard.ts` (новый) | 59 |
| `src/shared/guards/rate-limit.guard.ts` (новый) | 48 |
| `src/shared/guards/phone-rate-limit.guard.ts` (новый) | 67 |
| `src/shared/utils/rate-limit-store.ts` (новый) | 89 |
| `src/shared/utils/rate-limit-response.ts` (новый) | 14 |
| `src/shared/utils/api-key-header.ts` (новый) | 9 |
| `src/shared/utils/session-header.ts` (новый) | 12 |
| `src/shared/exceptions/too-many-requests.exception.ts` (новый) | 23 |
| `src/shared/decorators/public-route.decorator.ts` (новый) | 10 |
| `src/shared/decorators/phone-rate-limited.decorator.ts` (новый) | 11 |
| `src/shared/decorators/session-string.decorator.ts` (новый) | 9 |

Изменённый продуктовый код:

| Файл | Изменение, строк |
|------|------------------|
| `src/telegram/telegram.controller.ts` | 54 |
| `src/telegram/telegram.module.ts` | 12 |
| `src/telegram/dto/messages.dto.ts` | 28 |
| `src/telegram/dto/auth.dto.ts` | 26 |
| `src/shared/constants/http.constants.ts` | 6 |
| `src/config/cors.config.ts` | 3 |

Тесты:

| Файл | Изменение, строк |
|------|------------------|
| `src/shared/guards/phone-rate-limit.guard.spec.ts` (новый) | 357 |
| `src/shared/utils/rate-limit-store.spec.ts` (новый) | 317 |
| `test/posts.e2e-spec.ts` (новый) | 283 |
| `src/shared/guards/rate-limit.guard.spec.ts` (новый) | 221 |
| `src/telegram/dto/messages.dto.spec.ts` | 219 |
| `src/shared/guards/api-key.guard.spec.ts` (новый) | 186 |
| `src/shared/utils/rate-limit-response.spec.ts` (новый) | 136 |
| `src/config/api-keys.config.spec.ts` (новый) | 119 |
| `src/shared/decorators/session-string.decorator.spec.ts` (новый) | 103 |
| `src/shared/utils/session-header.spec.ts` (новый) | 80 |
| `test/auth.e2e-spec.ts` | 71 |
| `test/app.e2e-spec.ts` | 64 |
| `src/telegram/dto/auth.dto.spec.ts` | 62 |
| `src/shared/decorators/public-route.decorator.spec.ts` (новый) | 49 |
| `src/shared/decorators/phone-rate-limited.decorator.spec.ts` (новый) | 49 |
| `src/shared/utils/api-key-header.spec.ts` (новый) | 40 |

Версия, документация и артефакты:

| Файл | Изменение, строк |
|------|------------------|
| `docs/testing/telegram-postman-collection.json` | 320 |
| `README.md` | 63 |
| `docs/testing/telegram-manual-testing.md` | 39 |
| `USAGE.md` | 13 |
| `CLAUDE.md` | 11 |
| `.claude/rules/architecture.md` | 10 |
| `HOW_TO_USE_API.md` | 10 |
| `CHANGELOG.md` | 7 |
| `QUICKSTART.md` | 6 |
| `START_HERE.md` | 6 |
| `TODO_FOR_USER.md` | 6 |
| `FIX_2FA_ERROR.md` | 6 |
| `PROJECT_STRUCTURE.md` | 2 |
| `package.json` | 2 |

Суммарно по отслеживаемым путям окна: 58 файлов, 3385 добавленных и 192 удалённых строки. В это число входят также файлы самого плана (`docs/plans/block-02-api-perimeter/*`, 127 строк) и память агентов (`.claude/agent-memory/*`, 62 строки) — они не являются ни кодом, ни документацией продукта.

Не попали в `diff --stat`, потому что не добавлены в индекс git:

| Файл | Строк (untracked) |
|------|-------------------|
| `docs/reviews/security-audit-2026-09-23.md` | 316 |
| `docs/reviews/drift-audit-2026-09-23.md` | 313 |
| `.claude/agent-memory/security-auditor/reference_recurring_exposure_patterns.md` | — (память агента, не измерялась) |

## Test evidence

Итоговый прогон после исправлений Finalize:

- `rtk npm run lint` — чисто
- `rtk npm run build` — успешно
- `rtk npm test` — 18 наборов, 209 тестов, все прошли
- `rtk npm run test:e2e` — 3 набора (`app`, `auth`, `posts`), 36 тестов, все прошли

Рост с 199 до 209 unit-тестов относительно Phase 03 — это регрессионные тесты на два дефекта, найденные аудитом и исправленные в Finalize.

Дымовой прогон на скомпилированном артефакте (`node dist/main`, подставной `API_KEYS`, без учётных данных Telegram) выполнен дважды — до и после исправлений аудита. Наблюдаемые результаты:

- health без ключа — 200
- `/telegram/me` без ключа и с неверным ключом — 401 с одинаковым телом ответа
- `/telegram/me` с ключом и без заголовка сессии — 200 `{"status":"failed"}`
- `sessionString` в query — 400 `property sessionString should not exist`
- некорректное имя канала — 400
- `hoursBack=0` — 400
- запрос с заголовком `x-session-string` доходит до сервиса
- 61-й запрос за минуту под одним ключом — 429 с `Retry-After` и полем `retryAfterSeconds`
- ни ключа доступа, ни строки сессии в журнале процесса нет

Не запускалось в этом прогоне: `rtk npm run test:cov`, поэтому числа покрытия в отчёте не приводятся.

## API artifacts

Контракт запросов изменился для внешних потребителей: ключ передаётся в `x-api-key`, строка сессии — в `x-session-string`, `sessionString` в query теперь даёт 400, превышение лимита даёт 429 с `Retry-After` и `retryAfterSeconds`. Артефакты ручного тестирования обновлены под новый контракт:

- [docs/testing/telegram-manual-testing.md](../testing/telegram-manual-testing.md) — модель авторизации, случаи периметра P1-P7 и валидации V8-V9
- [docs/testing/telegram-postman-collection.json](../testing/telegram-postman-collection.json) — папка `perimeter` и переменная `apiKey`; значения `apiKey`, `phoneNumber`, `phoneCode`, `password` и `sessionString` в коллекции пустые

## Findings fixed during Finalize

Два дефекта найдены [аудитом безопасности](../reviews/security-audit-2026-09-23.md) уже после Phase 03, оба — в собственном коде блока 02, оба исправлены внутри Finalize и покрыты новыми тестами:

- `RateLimitStore` при заполненном хранилище больше не вытесняет самое старое живое окно, а отказывает в обслуживании (fail closed). Прежнее поведение позволяло потоком из 1000 неизвестных номеров сбросить счётчик конкретного номера, то есть ограничитель деградировал ровно под той нагрузкой, ради которой существует.
- Субъект лимита по номеру телефона нормализуется до цифр, поэтому `+7…` и `7…` больше не получают два независимых счётчика.

Документация, приведённая в соответствие с кодом в рамках Finalize (находка HIGH-4 аудита и находки D1-D11 проверки дрейфа): `README.md`, `USAGE.md`, `HOW_TO_USE_API.md`, `QUICKSTART.md`, `START_HERE.md`, `TODO_FOR_USER.md`, `FIX_2FA_ERROR.md`, `PROJECT_STRUCTURE.md`, `.claude/rules/architecture.md`, `CLAUDE.md`, `docs/testing/telegram-manual-testing.md`, `docs/testing/telegram-postman-collection.json`.

## Problems and tech debt

Файла `reflect.md` в папке плана нет; список ниже собран из доказательств фаз, handoff-записей [history.md](../plans/block-02-api-perimeter/history.md), [аудита безопасности](../reviews/security-audit-2026-09-23.md), [проверки дрейфа](../reviews/drift-audit-2026-09-23.md) и наблюдений Finalize.

Вердикт аудита безопасности:

- Сам периметр находок уровня CRITICAL не несёт — критерий приёмки Phase 04 выполнен. Но сервис по-прежнему нельзя открывать публично, и причина теперь другая: находки лежат за периметром, все в `TelegramService` и все вне объёма этого блока — префикс строки сессии и номер телефона пишутся в stdout, строки сессии хранятся в открытом виде в `data/`, сырой текст ошибки MTProto возвращается вызывающей стороне.

Пробел в самом плане, а не в его реализации:

- HIGH-1 аудита: общего ограничения на `POST /telegram/auth` нет. Лимит по номеру — 5 в час, общий лимит — 60 в минуту по ключу, поэтому один действительный ключ по-прежнему может заказать SMS на множество разных номеров, порядка 3600 в час. Требует решения пользователя о политике: нужен третий счётчик — общий лимит на маршрут авторизации.

Остаточное в коде блока:

- Счётчик по номеру увеличивается до валидации DTO, потому что гварды выполняются раньше пайпов: пять запросов с некорректным телом блокируют чужой номер на час, не отправив ни одной SMS.
- `getApiKeysConfig` пишет предупреждение на каждый запрос, пока `API_KEYS` не задан.
- Счётчики лимитов живут в памяти процесса: они сбрасываются на каждом выкате и удваиваются при второй реплике. Это режим отказа, уже записанный в [risks.md](../plans/block-02-api-perimeter/risks.md).

Зависимости:

- `rtk npm audit` на момент аудита: 40 уязвимостей, из них 21 высокого уровня. Исправление требует мажорного обновления `@nestjs/*` — отдельный блок.

Гейты и унаследованное:

- Ветка — `r-1.4.0`, целевая версия — `1.4.1`, поэтому гейт ветки из `.claude/rules/versioning-changelog.md` не выполнен. Смена ветки требует явного согласия пользователя и не выполнялась.
- `pln.md` по-прежнему описывает старый контракт со строкой сессии в query. Это исторический документ планирования, он оставлен без изменений намеренно.
- `AuthResponseDto` лежит в `dto/`, хотя это форма ответа — унаследованное расхождение с `.claude/rules/typescript.md`.
- Юнит-тестов у `TelegramService` и `TelegramController` нет вовсе; это не входило в объём блока 02.
