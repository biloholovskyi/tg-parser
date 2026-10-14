# Отчёт о завершении плана — block-12-digest-cost-flood 1.6.0

- Компонент: `block-12-digest-cost-flood`
- Версия: `1.6.0`
- Дата: 2026-10-14
- Ветка: `r-1.6.0` (пользователь переключился на неё 14.10.2026 в 11:02, до начала Phase 01)
- Тир сложности: `standard`
- План: [block-12-digest-cost-flood-implementation-plan.md](../plans/block-12-digest-cost-flood/block-12-digest-cost-flood-implementation-plan.md)
- Замысел: [design.md](../plans/block-12-digest-cost-flood/design.md) · Риски и откат: [risks.md](../plans/block-12-digest-cost-flood/risks.md) · Research: [research.md](../plans/block-12-digest-cost-flood/research.md)
- Решение по хранению: [adr-channel-peer-cache.md](../plans/block-12-digest-cost-flood/adr-channel-peer-cache.md)
- Ход работ: [history.md](../plans/block-12-digest-cost-flood/history.md) · Итоги: [reflect.md](../plans/block-12-digest-cost-flood/reflect.md)
- Redis на Railway, ключи `tg:peer:*`: [railway-redis.md](../deployment/railway-redis.md)

## Summary

Дайджест стал дешевле и перестал срываться на лимитах Telegram. По умолчанию (`DIGEST_TRANSLATION=off`) сводку строит основная модель прямо по оригиналам постов, отдельный перевод включается переменной и выполняется настраиваемой дешёвой моделью `GROK_TRANSLATION_MODEL`; лог показывает расход токенов по этапам. Каналы больше не ищутся по имени при каждом запуске — `channelId` и `accessHash` хранятся в кэше `ChannelPeerCache` (Redis или ограниченная память), а короткий flood wait (ожидание, которое Telegram требует при превышении частоты запросов) выдерживается, и сбор продолжается с того же канала.

## Phases

| Фаза | Статус | Доказательство |
|------|--------|----------------|
| [Phase 01 — кэш каналов и время ожидания в логе](../plans/block-12-digest-cost-flood/phase-01-channel-peer-cache.md) | done | lint и build зелёные; `rtk npm test` — 64 набора, 1387 тестов, все прошли; повторное чтение канала не вызывает `getInputEntity`, лог `429 (FLOOD_WAIT_N)` |
| [Phase 02 — ожидание лимита и продолжение сбора](../plans/block-12-digest-cost-flood/phase-02-flood-wait-resume.md) | done | `rtk npm test` — 65 наборов, 1410 тестов, все прошли; остановка во время паузы завершает запуск без отправки и без оставшихся таймеров |
| [Phase 03 — сводка по оригиналам, модель перевода, обрезка постов](../plans/block-12-digest-cost-flood/phase-03-digest-cost.md) | done | `rtk npm test` — 66 наборов, 1497 тестов, все прошли; в режиме `off` `translate` не вызывается |
| [Phase 04 — Finalize](../plans/block-12-digest-cost-flood/phase-04-finalize.md) | done (этот закрывающий прогон), кроме настоящего запуска дайджеста на Railway и решения по ветке — за пользователем | Итоговые проверки зелёные, аудит без находок, локальный smoke — см. Test evidence; версия `1.6.0` в `package.json`, `package-lock.json` и `CHANGELOG.md` |

Phase 04 закрыта после этого отчёта (он — восьмой пункт её чеклиста). Критерий приёмки Finalize «смоук-запуск доставил дайджест» не подтверждён, как и критерий Phase 03 «тезисы приходят по-русски при украинских и английских оригиналах».

## Affected files

База измерения — `HEAD` (`28cf333`), вся работа по плану не закоммичена. Размеры взяты из `git diff --stat HEAD`, выполненного при написании отчёта: 51 файл, 3793 добавленные и 144 удалённые строки — совпадает с замером вызывающей стороны. Этот отчёт и правка `docs/reports/README.md` в замер не входят. Единственный неотслеживаемый файл окна — `docs/plans/block-12-digest-cost-flood/reflect.md` (25 строк по `wc -l`).

Суммы по категориям (`git diff --shortstat HEAD`): продуктовый код — 16 файлов, +671 / −121; тесты — 15 файлов, +2634 / −14; артефакты плана — 10 файлов, +438; память агентов — 1 файл, +19.

Продуктовый код:

| Файл | Изменение, строк |
|------|------------------|
| `src/digest/translation.service.ts` | 129 |
| `src/telegram/channel-peer-cache.ts` | 124 (новый) |
| `src/digest/post-collector.ts` | 122 |
| `src/digest/digest.service.ts` | 100 |
| `src/telegram/channel.service.ts` | 71 |
| `src/config/digest.config.ts` | 54 |
| `src/digest/grok/grok-usage.ts` | 45 (новый) |
| `src/digest/summary.service.ts` | 39 |
| `src/digest/utils/cancellable-delay.ts` | 35 (новый) |
| `src/digest/grok/grok.client.ts` | 17 |
| `src/telegram/utils/telegram-errors.ts` | 17 |
| `src/telegram/constants.ts` | 12 |
| `src/digest/constants.ts` | 11 |
| `src/digest/interfaces/digest-topic.interface.ts` | 11 |
| `src/digest/grok/prompts.ts` | 3 |
| `src/telegram/telegram.module.ts` | 2 |

Тесты:

| Файл | Изменение, строк |
|------|------------------|
| `src/digest/digest.service.spec.ts` | 423 |
| `src/telegram/channel.service.spec.ts` | 393 (новый) |
| `src/telegram/channel-peer-cache.spec.ts` | 371 (новый) |
| `src/digest/translation.service.spec.ts` | 261 |
| `src/digest/post-collector.spec.ts` | 240 |
| `src/config/digest.config.spec.ts` | 221 |
| `src/digest/grok/grok.client.spec.ts` | 217 |
| `src/digest/utils/cancellable-delay.spec.ts` | 163 (новый) |
| `src/digest/grok/grok-usage.spec.ts` | 145 (новый) |
| `src/telegram/utils/telegram-errors.spec.ts` | 94 |
| `src/digest/summary.service.spec.ts` | 68 |
| `src/telegram/telegram.service.spec.ts` | 32 |
| `src/digest/grok/prompts.spec.ts` | 14 |
| `src/digest/bot-notifier.spec.ts` | 3 |
| `src/digest/digest.scheduler.spec.ts` | 3 |

Документация, правила и версия:

| Файл | Изменение, строк |
|------|------------------|
| `CLAUDE.md` | 12 |
| `docs/deployment/railway-redis.md` | 6 |
| `CHANGELOG.md` | 5 |
| `.claude/rules/runtime-resources.md` | 4 |
| `package-lock.json` | 4 |
| `.claude/rules/architecture.md` | 3 |
| `.claude/rules/telegram.md` | 2 |
| `README.md` | 2 |
| `package.json` | 2 |

Новых зависимостей нет: `package.json` и `package-lock.json` изменились только номером версии.

Также в окне: артефакты плана `docs/plans/block-12-digest-cost-flood/*` (10 отслеживаемых файлов, 438 строк, и неотслеживаемый `reflect.md`) и память агента `.claude/agent-memory/test-writer/project_test_setup_gotchas.md` (19 строк).

## Test evidence

Итоговый прогон Finalize, по данным вызывающей стороны:

- `rtk npm run lint` — без ошибок
- `rtk npm run build` — без ошибок
- `rtk npm test` — 66 наборов, 1497 тестов, все прошли
- `rtk npm run test:e2e` — 5 наборов, 68 тестов, все прошли

При написании отчёта тесты повторно не запускались. `rtk npm run test:cov` не запускался, поэтому числа покрытия не приводятся.

Аудит безопасности и ресурсов (выполнен в Finalize без отдельного отчёта в `docs/reviews/`):

- новые строки лога и алертов не содержат `sessionString`, `accessHash` и телефона;
- единственный новый таймер (пауза flood wait) очищается и при срабатывании, и при отмене, у него вызван `unref()`;
- кэш каналов в памяти ограничен `CHANNEL_PEER_CACHE_MAX_ENTRIES`;
- новых чтений `process.env` вне `src/config/` нет.

Локальный smoke 14.10.2026, по данным вызывающей стороны:

- собранный сервис запущен с локальным `.env` (без Redis, дайджест не настроен);
- все модули, включая `TelegramModule` с `ChannelPeerCache`, инициализировались — это закрывает пробел Phase 01 «нет DI-теста на `ChannelPeerCache`» для режима памяти;
- `GET /telegram/health` — 200;
- `POST /digest/run` без `x-api-key` — 401.

Не выполнено — за пользователем, требует деплоя на Railway:

- настоящий запуск дайджеста `POST /digest/run` в режиме `off`;
- кэш каналов в Redis: второй запуск без поиска каналов по имени;
- поддержка `response_format: json_schema` моделью перевода `grok-4.20-0309-non-reasoning`;
- тезисы по-русски, построенные по оригиналам;
- расход токенов по этапам и его сравнение с запуском версии 1.5.1 — чисел токенов в отчёте нет, они не наблюдались.

## API artifacts

REST-контракт не менялся: маршрутов, DTO и форм ответа не добавлено и не изменено. Артефакты в `docs/testing/` не нужны и не создавались.

Новые необязательные переменные окружения: `DIGEST_TRANSLATION` (по умолчанию `off`), `GROK_TRANSLATION_MODEL` (по умолчанию `grok-4.20-0309-non-reasoning`), `GROK_TRANSLATION_REASONING_EFFORT` (по умолчанию `off`) — описаны в индексе плана и в `CLAUDE.md`. Новое хранимое состояние — ключи `tg:peer:*` в Redis, их сброс описан в [railway-redis.md](../deployment/railway-redis.md).

## Problems and tech debt

Источники: [reflect.md](../plans/block-12-digest-cost-flood/reflect.md), доказательства фаз, [history.md](../plans/block-12-digest-cost-flood/history.md) и факты вызывающей стороны.

Решения за пользователем:

- Ветка `r-1.6.0`, `package.json` 1.6.0 и `CHANGELOG.md` `[1.6.0] 14.10.2026` согласованы; коммит — только по просьбе пользователя.
- Настоящий запуск дайджеста на Railway — см. Test evidence. До него непроверенными остаются критерии приёмки Phase 03 и Phase 04.
- Цена запуска по тарифам xAI — расчёт за пользователем.
- Коммит — только по явной просьбе пользователя.

Технический долг из `reflect.md`:

- Поддержка `response_format: json_schema` у `grok-4.20-0309-non-reasoning` не подтверждена документацией xAI. Если её нет, перевод не выполняется (резервные тезисы остаются без перевода). Быстрый откат без кода описан в [risks.md](../plans/block-12-digest-cost-flood/risks.md): `DIGEST_TRANSLATION=on`, `GROK_TRANSLATION_MODEL=grok-4.6`, `GROK_TRANSLATION_REASONING_EFFORT=low`.
- Нет теста Nest DI на `TelegramModule` с `ChannelPeerCache` и настоящим `REDIS_CLIENT`; локальный smoke подтвердил только режим памяти.
- При остановке отменяется только сбор постов; запросы Grok и Bot API дорабатывают до своих таймаутов.
- Частичный дайджест при ожидании сверх `DIGEST_FLOOD_WAIT_MAX_S` или `DIGEST_FLOOD_WAIT_TOTAL_MAX_S` не делался по решению пользователя: такой запуск заканчивается сообщением об ошибке в бот.

Принятые риски из [risks.md](../plans/block-12-digest-cost-flood/risks.md) и ADR:

- Если имя канала передано другому каналу без ошибки Telegram, старый канал читается до `CHANNEL_PEER_TTL_S`; сброс — удалить ключи `tg:peer:*`.
- Значения кэша каналов хранятся в Redis без шифрования; в ключе только SHA-256 сессии.

Отличия от дизайна (записаны в `reflect.md`):

- Резервные тезисы переводятся тем же промптом и механизмом, что и посты; отдельного промпта нет, `design.md` исправлен.
- Кэш каналов использует Redis при любом `REDIS_URL`, независимо от `SESSION_ENCRYPTION_KEY`.
- `CHANNEL_PRIVATE` на запомненном канале тоже даёт один повторный поиск по имени.
- Строка лога сводки содержит токены, но не имя модели.
