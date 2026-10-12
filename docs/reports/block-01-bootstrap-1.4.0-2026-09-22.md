# Отчёт о завершении плана — block-01-bootstrap 1.4.0

- Компонент: `block-01-bootstrap`
- Версия: `1.4.0`
- Дата: 2026-09-22
- Ветка: `r-1.4.0`
- Тир сложности: `standard`
- План: [block-01-bootstrap-implementation-plan.md](../plans/block-01-bootstrap/block-01-bootstrap-implementation-plan.md)
- Риски: [risks.md](../plans/block-01-bootstrap/risks.md) · Research: [research.md](../plans/block-01-bootstrap/research.md) · Хронология: [history.md](../plans/block-01-bootstrap/history.md)
- Аудит безопасности: [security-audit-2026-09-22.md](../reviews/security-audit-2026-09-22.md)

## Summary

Приложение теперь стартует с включённой глобальной проверкой входных данных, закрытым по умолчанию списком источников CORS и ограничением размера тела запроса, а фоновая ошибка сети больше не завершает процесс. Health-проверка сведена к одному дешёвому маршруту `GET /telegram/health` с константным ответом, совпадающему с путём из `railway.toml`; дублирующие `GET /` и `GET /health` удалены. Версия поднята до `1.4.0`, CHANGELOG и документация приведены в соответствие с кодом.

## Phases

| Фаза | Статус | Доказательство |
|------|--------|----------------|
| [Phase 01 — валидация запросов и ограничение CORS](../plans/block-01-bootstrap/phase-01-validation-cors.md) | done | `configureHttpPipeline` включает `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`), лимит тела по `REQUEST_BODY_MAX_BYTES` и CORS из `src/config/cors.config.ts`; гейты на момент фазы: lint и build чисто, `rtk npm test` — 5 suites, 41 тест, зелёные |
| [Phase 02 — устойчивость процесса и health-проверка](../plans/block-01-bootstrap/phase-02-process-stability.md) | done | `unhandledRejection` только логируется, `uncaughtException` уходит в штатное закрытие приложения; `AppController` удалён, health отдаёт константный ответ; гейты на момент фазы: lint и build чисто, `rtk npm test` — 7 suites, 59 тестов, `rtk npm run test:e2e` — 1 suite, 5 тестов, зелёные |
| [Phase 03 — Finalize](../plans/block-01-bootstrap/phase-03-finalize.md) | done (этот закрывающий прогон) | post-code зелёный, аудит безопасности выполнен и его находки в объёме блока исправлены, дымовой прогон на скомпилированном артефакте выполнен, проверка дрейфа выполнена, артефакты `docs/testing/` созданы, версия и CHANGELOG синхронизированы |

Замечание по факту: в файле `phase-03-finalize.md` на момент написания отчёта стоит статус `todo` и незакрытые пункты чеклиста — этот отчёт и строка в [индексе отчётов](README.md) являются последним пунктом того же чеклиста и закрываются вместе с ним.

## Affected files

База измерения — `HEAD` (`a698738`): все изменения плана на момент отчёта не закоммичены, размеры взяты из `rtk git diff --stat HEAD`. Файлы, ещё не добавленные в индекс git, в `diff --stat` не попадают — для них указано число строк (`wc -l`) с пометкой untracked.

Продуктовый код:

| Файл | Изменение, строк |
|------|------------------|
| `src/main.ts` | 75 |
| `src/app.module.ts` | 21 |
| `src/config/cors.config.ts` (новый) | 51 |
| `src/shared/constants/http.constants.ts` (новый) | 7 |
| `src/shared/utils/http-pipeline.ts` (новый) | 57 |
| `src/shared/utils/process-handlers.ts` (новый) | 90 |
| `src/telegram/dto/auth.dto.ts` | 33 |
| `src/telegram/dto/messages.dto.ts` | 15 |
| `src/telegram/telegram.controller.ts` | 9 (по смыслу одна строка: константное тело health) |
| `tsconfig.build.json` (новый, untracked) | 4 |

Сборка, версия, документация:

| Файл | Изменение, строк |
|------|------------------|
| `package.json` | 34 |
| `CHANGELOG.md` | 7 |
| `CLAUDE.md` | 163 |
| `README.md` | 3 |
| `DEPLOYMENT.md` | 2 |
| `.claude/rules/architecture.md` | 9 |
| `.claude/rules/api-security.md` | 2 |
| `.claude/rules/typescript.md` | 2 |
| `.claude/rules/refactor-security-audit.md` | 2 |
| `.claude/skills/audit-security/SKILL.md` | 2 |
| `.claude/agents/tg-parser-backend-expert.md` | 4 |

Оговорка по двум числам: в окне измерения `CLAUDE.md` и `package.json` содержат также незакоммиченную миграцию конфигурации `.claude/`, которая предшествует этому плану. По индексу git: из 163 строк `CLAUDE.md` в индексе лежит 160 строк той миграции, из 34 строк `package.json` — 31. Правки самого плана в этих двух файлах — остаток вне индекса (в `CLAUDE.md` это `CORS_ALLOWED_ORIGINS` и порт по умолчанию, в `package.json` — версия `1.4.0` и объявление `express` прямой зависимостью). Разделить два набора правок построчно средствами git нельзя, поэтому числа приведены как есть.

Новые спецификации тестов:

| Файл | Изменение, строк |
|------|------------------|
| `src/config/cors.config.spec.ts` | 104 |
| `src/shared/constants/http.constants.spec.ts` | 34 |
| `src/shared/utils/http-pipeline.spec.ts` | 307 |
| `src/shared/utils/process-handlers.spec.ts` | 406 |
| `src/telegram/dto/auth.dto.spec.ts` | 259 |
| `src/telegram/dto/messages.dto.spec.ts` | 103 |
| `test/app.e2e-spec.ts` | 129 |
| `test/auth.e2e-spec.ts` (untracked) | 167 |

Суммарно по отслеживаемым путям плана: 22 файла, 1797 добавленных и 112 удалённых строк.

## Test evidence

Итоговый прогон после исправлений Finalize:

- `rtk npm test` — 7 suites, 85 тестов, все прошли
- `rtk npm run test:e2e` — 2 suites, 13 тестов, все прошли
- `rtk npm run lint` — чисто
- `rtk npm run build` — чисто

Рост относительно Phase 02 (59 unit, 5 e2e) — это регрессионные тесты на находки, исправленные в Finalize, включая новый набор `test/auth.e2e-spec.ts`.

Дымовой прогон на скомпилированном артефакте (`npm run start:prod`, порт 3999, `CORS_ALLOWED_ORIGINS=https://allowed.example.com`) — наблюдаемые результаты:

- health отвечает ровно `{"status":"ok"}`
- неизвестное поле в теле запроса → 400
- разрешённый `Origin` получает заголовок `Access-Control-Allow-Origin`, чужой `Origin` — не получает
- JSON сверх лимита → 413
- `text/plain` сверх лимита → 413
- пустые `phoneCode` и `password` трактуются как отсутствующие (отклонён только намеренно невалидный номер)
- `GET /` и `GET /health` → 404

Не запускалось в этом прогоне: `rtk npm run test:cov`, поэтому числа покрытия в отчёте не приводятся.

## API artifacts

Контракт изменился: ответ на невалидное тело запроса (400 вместо 200 с сообщением), удаление маршрутов `GET /` и `GET /health`, константное тело health без `timestamp`. Артефакты ручного тестирования созданы в этом блоке:

- [docs/testing/telegram-manual-testing.md](../testing/telegram-manual-testing.md) — сценарии health, валидации тела, CORS, авторизации и устойчивости процесса
- [docs/testing/telegram-postman-collection.json](../testing/telegram-postman-collection.json) — коллекция Postman; значения `phoneNumber`, `phoneCode`, `password` и `sessionString` в ней пустые

## Findings fixed during Finalize

Все пункты ниже найдены после Phase 02 — аудитом безопасности и дымовым прогоном — и исправлены внутри Finalize; проверки после исправлений перезапущены:

- Регрессия сборки, которую поймал дымовой прогон, а не гейты: добавление `test/app.e2e-spec.ts` сместило точку входа скомпилированного кода на `dist/src/main.js`, и `npm run start:prod` (команда старта на Railway) падала с `Cannot find module dist/main`. Исправлено новым `tsconfig.build.json`, который заодно держит спецификации вне сборки.
- Ограничение размера тела применялось только к json и urlencoded; новая прослойка `enforceContentLengthLimit` ограничивает любой тип содержимого.
- На один сигнал приходились два пути остановки (`app.enableShutdownHooks()` плюс собственные слушатели сигналов). Хуки Nest больше не используются, собственные обработчики — единственный путь, при этом `app.close()` по-прежнему отрабатывает хуки жизненного цикла.
- `closeApplication` не имела защиты от повторного входа и не имела таймаута: теперь она одноразовая и ограничена по времени `SHUTDOWN_TIMEOUT_MS`.
- Пустые `phoneCode` и `password` отклонялись с 400, хотя сервис трактует их как первый шаг авторизации (режим отказа 1 в [risks.md](../plans/block-01-bootstrap/risks.md)). Пустые строки теперь отображаются в отсутствующее значение.
- `express` импортировался напрямую, но не был объявлен зависимостью — объявлен.
- Из глобального `ValidationPipe` убран `enableImplicitConversion`, поэтому число в JSON больше не принимается молча в строковое поле.

## Deliberate deviation

Раздел «Границы» плана заявлял, что блок не трогает `src/telegram/telegram.controller.ts`. В Phase 02 единственная health-проверка должна была отдавать константный ответ, поэтому из её маршрута убран `timestamp` — правка на одну строку в этом файле. Отклонение зафиксировано в доказательствах Phase 02 и в handoff-записи `history.md`.

## Problems and tech debt

Файла `reflect.md` в папке плана нет; список ниже собран из доказательств фаз, handoff-записей [history.md](../plans/block-01-bootstrap/history.md), [аудита безопасности](../reviews/security-audit-2026-09-22.md) и наблюдений Finalize.

Периметр REST (владелец — блок 02):

- Ни один маршрут не требует аутентификации вызывающей стороны (`x-api-key`) и не ограничен по частоте. Вердикт аудита: до появления этого пласта развёртывание не должно оставаться публично открытым.
- `sessionString` передаётся в строке запроса.
- `GetPostsDto` объявлен, но ни к одному маршруту не привязан: `channelUsername` доходит до MTProto без проверки формата, а `hoursBack` проверяется по диапазону вручную. Владелец — блок 02, фаза 03.

Ресурсы времени выполнения (владелец — блоки 03-05):

- Кэш сессий не ограничен, нет отключения клиентов в `onModuleDestroy`, опции flood и повторов GramJS оставлены по умолчанию.
- Синхронный доступ к файловой системе на путях обработки запросов.
- `console.*` в `telegram.service.ts`, откуда из строк логирования достижим телефонный номер.

Тесты:

- Нет юнит-спецификаций для `telegram.service.ts` и `telegram.controller.ts` — владелец блок 06.
- `bootstrap()` в `src/main.ts` остаётся без теста: файл вызывает `void bootstrap()` при импорте и не экспортирует точку входа.

Остаточное ограничение этого блока:

- `enforceContentLengthLimit` доверяет заголовку `content-length`, поэтому запрос с потоковой передачей (chunked) того типа содержимого, который не разбирает ни один парсер, остаётся без ограничения.

Зависимости и внешние находки:

- `rtk npm audit --omit=dev`: 13 уязвимостей (6 высоких, 7 средних); исправления требуют мажорных обновлений `@nestjs/*` — отдельный блок.
- 13 находок аудита безопасности остаются открытыми вне этого блока; полный список — в [security-audit-2026-09-22.md](../reviews/security-audit-2026-09-22.md).

Требуют решения пользователя:

- Является ли `process.exit` после `uncaughtException` тем осознанным путём остановки, который подразумевают правила.
- Следует ли пометить как желаемое, а не действующее, утверждение `CLAUDE.md` в настоящем времени о том, что кэш сессий ограничен, — до появления блоков 03-05.
