# Phase 01 — Валидация запросов и ограничение CORS

Статус: done

Требуемые правила: `.claude/rules/api-security.md`, `.claude/rules/architecture.md`, `.claude/rules/patterns.md`, `.claude/rules/testing.md`

## Цель

Каждый входящий запрос проходит проверку схемы, а браузерный доступ ограничен явным списком источников.

## Заметки по реализации

Загрузчик источников CORS пишется с нуля в `src/config/` по образцу `telegram.config.ts`. Регистрация пайпа и CORS — точечная правка `src/main.ts`.

## Объём

- Глобальный `ValidationPipe` с `whitelist`, `forbidNonWhitelisted` и преобразованием типов зарегистрирован при загрузке приложения.
- Список разрешённых источников CORS читается через загрузчик в `src/config/`; пустое значение означает запрет браузерных источников, а не разрешение всех.
- Разрешённые методы и заголовки перечислены явно, включая заголовок передачи строки сессии из блока 02.
- Тело запроса ограничено по размеру константой REQUEST_BODY_MAX_BYTES.
- Новая переменная окружения описана в `CLAUDE.md` в разделе Environment Variables.

## Чеклист

- [x] Загрузчик конфигурации CORS в `src/config/` с юнит-тестом на пустое, одиночное и множественное значение
- [x] `ValidationPipe` зарегистрирован глобально
- [x] Ограничение размера тела запроса включено
- [x] Переменная окружения описана в `CLAUDE.md`
- [x] Тесты фазы написаны агентом `test-writer`

## Команды проверки

- `rtk npm run lint`
- `rtk npm run build`
- `rtk npm test`

## Критерии приёмки

- Запрос с неизвестным полем в теле получает 400 без обращения к Telegram.
- Запрос с источником вне списка получает отказ CORS, серверный вызов без заголовка Origin проходит.
- Тело сверх лимита отклоняется до попадания в контроллер.
- Юнит-тесты загрузчика конфигурации зелёные.

## Доказательства

- `src/config/cors.config.ts` — загрузчик allowlist из `CORS_ALLOWED_ORIGINS`; пустое значение даёт пустой список, `*` отбрасывается; методы, заголовки и `credentials` заданы константами (`x-api-key` и `x-session-string` включены заранее для блока 02).
- `src/shared/utils/http-pipeline.ts` — `configureHttpPipeline` включает лимит тела по `REQUEST_BODY_MAX_BYTES` (`src/shared/constants/http.constants.ts`), глобальный `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`) и CORS из загрузчика; `src/main.ts` создаёт приложение с `bodyParser: false` и вызывает его.
- `src/telegram/dto/auth.dto.ts`, `src/telegram/dto/messages.dto.ts` — request-DTO получили декораторы `class-validator`; без этого `whitelist` вырезал бы `phoneNumber` и сломал `POST /telegram/auth`.
- `CLAUDE.md` — строка `CORS_ALLOWED_ORIGINS` в Environment Variables.
- Тесты (`test-writer`): `cors.config.spec.ts`, `http-pipeline.spec.ts`, `auth.dto.spec.ts`, `messages.dto.spec.ts`.
- Гейты: `rtk npm run lint` чисто, `rtk npm run build` чисто, `rtk npm test` — 5 suites, 41 тест, все зелёные.
- Критерии приёмки проверены тестами: лишнее поле в теле → 400 без вызова хендлера; тело сверх лимита → 413 до контроллера; Origin из списка получает заголовок, чужой Origin не получает, запрос без Origin проходит.
