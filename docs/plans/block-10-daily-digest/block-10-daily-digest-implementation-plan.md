# Блок 10 — Ежедневный дайджест каналов

## Миссия

- Раз в сутки, в 23:00 по Киеву, и по ручному запросу сервис собирает посты за 24 часа из каналов списка, переводит их на русский, сворачивает через Grok в сухое саммари по темам без потери постов и отправляет его в Telegram-бота.
- Сессии Telegram хранятся в Redis в зашифрованном виде и переживают перезапуск.

## Профиль задачи

`feature` — 4 сигнала feature (новая возможность, новые маршруты, несколько модулей, архитектурная развилка по хранению), 0 сигналов bugfix.

## Тир сложности

`standard` — меняется модель хранения сессий и жизненный цикл клиента, новые внешние зависимости (Redis, Grok, Bot API), два новых маршрута, новый модуль.

## Целевая версия

1.5.0 (указана пользователем).

## Высокорисковая поверхность

Да — хранение секретов, кэш сессий, REST-периметр, изменение того, что сервис хранит. Риски: [risks.md](risks.md).

## Артефакты до кода

- Исследование: [research.md](research.md)
- Дизайн: [design.md](design.md)
- Решение по хранению: [adr-session-redis.md](adr-session-redis.md)
- Риски и откат: [risks.md](risks.md)

## Фазы

- Phase 01 (done, проверка на Railway за пользователем) — сессии в Redis: [phase-01-redis-sessions.md](phase-01-redis-sessions.md)
- Phase 02 (done) — сессия дайджеста и сбор постов: [phase-02-digest-session-and-collection.md](phase-02-digest-session-and-collection.md)
- Phase 03 (done) — перевод и саммари через Grok: [phase-03-grok-translate-summarize.md](phase-03-grok-translate-summarize.md)
- Phase 04 (done) — отправка в бота, расписание, ручной запуск: [phase-04-delivery-schedule-endpoint.md](phase-04-delivery-schedule-endpoint.md)
- Phase 05 (done, реальный smoke за пользователем) — Finalize: [phase-05-finalize.md](phase-05-finalize.md)

Отчёт: [block-10-daily-digest-1.5.0-2026-09-26.md](../../reports/block-10-daily-digest-1.5.0-2026-09-26.md)

## Порядок и границы

- Фазы строго последовательны: Phase 02 опирается на репозиторий сессий, Phase 04 — на результаты Phase 02 и 03.
- Phase 01 первая как самая рискованная: она меняет путь каждой сессии.
- Phase 03 не зависит от Telegram и может тестироваться на подделках целиком.

## Покрытие правил

- `.claude/rules/telegram.md` — секреты, граница GramJS, отображение ошибок
- `.claude/rules/runtime-resources.md` — потолки, таймауты, закрытие Redis и задачи по расписанию
- `.claude/rules/api-security.md` — ключ вызывающего и лимит на новых маршрутах, сессия только в заголовке
- `.claude/rules/api-contracts.md` — интерфейсы ответов и артефакты ручного тестирования
- `.claude/rules/architecture.md` — раскладка модуля `src/digest/`
- `.claude/rules/patterns.md` — пределы функций, константы
- `.claude/rules/testing.md` — тесты внутри каждой фазы, автор — `test-writer`
- `.claude/rules/drift-audit.md` — переписывание модели сессий в правилах

## Решённые вопросы

Все ответы пользователя собраны в разделе «Решения пользователя» в [research.md](research.md).

## Следующие действия

1. Пользователь читает план и присылает правки.
2. Подключить Redis на Railway по инструкции `docs/deployment/railway-redis.md` из Phase 01.
3. Получить `GROK_API_KEY` и данные бота к smoke-прогону в Phase 05.
4. Реальный smoke-прогон по `docs/testing/digest-manual-testing.md`.
5. Переименовать ветку в `r-1.5.0` и закоммитить — по запросу пользователя.
