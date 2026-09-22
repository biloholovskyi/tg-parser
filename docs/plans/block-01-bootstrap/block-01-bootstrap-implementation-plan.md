# Блок 01 — Загрузка приложения

## Миссия

- Приложение стартует с включённой проверкой входных данных, закрытым CORS и предсказуемым поведением при фоновых ошибках.
- Процесс переживает сетевой сбой GramJS и остаётся обслуживать запросы.

## Профиль задачи

`feature` — 2 сигнала: изменение поведения на границе HTTP, влияние на контракт ответов при невалидном теле запроса.

## Тир сложности

`standard` — затронута высокорисковая поверхность (периметр REST и устойчивость процесса). Правило: всё, что трогает HIGH_RISK_SURFACE, идёт по `standard`.

## Целевая версия

`1.4.0` — по имени ветки `r-1.4.0` (в `package.json` пока `1.3.1`; синхронизация — в Finalize, `.claude/rules/versioning-changelog.md`).

## Высокорисковая поверхность

Да — периметр REST и жизненный цикл процесса. Риски: [risks.md](risks.md).

## Фазы

- Phase 01 (done) — валидация запросов и ограничение CORS: [phase-01-validation-cors.md](phase-01-validation-cors.md); lint/build/test зелёные, 41 тест
- Phase 02 (done) — устойчивость процесса и health-проверка: [phase-02-process-stability.md](phase-02-process-stability.md); lint/build/test/e2e зелёные, 59 unit + 5 e2e
- Phase 03 (done) — Finalize: [phase-03-finalize.md](phase-03-finalize.md); проверки зелёные, дымовой прогон пройден, отчёт [docs/reports/block-01-bootstrap-1.4.0-2026-09-22.md](../../reports/block-01-bootstrap-1.4.0-2026-09-22.md)

## Покрытие правил

- `.claude/rules/api-security.md` — ValidationPipe, CORS, лимит тела запроса
- `.claude/rules/runtime-resources.md` — запрет `process.exit` в общем обработчике ошибок
- `.claude/rules/architecture.md` — где подключается валидация
- `.claude/rules/testing.md` — тесты внутри фазы
- `.claude/rules/post-code-workflow.md` — гейты качества

## Границы

Этот план не трогает `src/telegram/telegram.service.ts` и `src/telegram/telegram.controller.ts`. Аутентификация вызывающей стороны и рейт-лимиты — блок 02.

## Статус

План закрыт. Изменения не закоммичены. Два открытых решения пользователя перечислены в [phase-03-finalize.md](phase-03-finalize.md).
