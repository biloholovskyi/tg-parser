# Phase 01 — Кэш каналов и время ожидания в логе (Часть Б)

## Статус

done

## Правила

`.claude/rules/telegram.md`, `.claude/rules/runtime-resources.md`, `.claude/rules/testing.md`

## Цель

Канал ищется по имени один раз на `CHANNEL_PEER_TTL_S`, а лог и алерт flood wait показывают длительность ожидания.

## Подсказки по реализации

- `ChannelPeerCache` пишется с нуля по образцу `SessionRepository`: `@Inject(REDIS_CLIENT)` с `null` для режима только памяти, команды с таймаутом клиента Redis.
- Кэш в памяти — `Map` с ограничением `CHANNEL_PEER_CACHE_MAX_ENTRIES` и вытеснением самой старой записи.
- `Api.InputPeerChannel` строится только внутри `src/telegram/`; `channelId` и `accessHash` хранятся строками и превращаются в `bigInt` при чтении.

## Объём

- `src/telegram/constants.ts`: `CHANNEL_PEER_KEY_PREFIX` (`tg:peer:`), `CHANNEL_PEER_TTL_S` (30 дней), `CHANNEL_PEER_CACHE_MAX_ENTRIES` (500), `CHANNEL_PEER_STALE_ERRORS`.
- `src/telegram/channel-peer-cache.ts`: `get`, `set`, `remove` по `(sessionString, username)`; ошибки Redis — warn и пустой результат.
- `src/telegram/channel.service.ts`: `openWalk` берёт канал из кэша, при промахе ищет и записывает; ошибка устаревшей записи — удаление и один повторный поиск.
- `src/telegram/telegram.module.ts`: провайдер `ChannelPeerCache`.
- `src/telegram/utils/telegram-errors.ts`: `describeError` даёт `FLOOD_WAIT_{seconds}` для flood wait с числовым `seconds`.
- Тесты: попадание, промах с записью, устаревшая запись с повторным поиском, Redis недоступен, режим памяти с вытеснением, ключ без `sessionString`, `describeError` с секундами.

## Чек-лист

- [ ] `ChannelPeerCache` и его тесты
- [ ] `ChannelService` использует кэш, тесты на все ветки
- [ ] `describeError` с секундами, тест
- [ ] Ни `sessionString`, ни `accessHash` не попадают в лог и алерт

## Проверка

- `rtk npm run lint`
- `rtk npm run build`
- `rtk npm test`

## Критерии приёмки

- Второе чтение того же канала той же сессией не вызывает `getInputEntity`.
- Устаревшая запись не ломает чтение: один повторный поиск, новая запись.
- Отказ Redis не меняет ответ эндпоинта постов.
- Лог flood wait выглядит как `429 (FLOOD_WAIT_N)`.

## Evidence

- lint, build зелёные; `rtk npm test`: 64 suites, 1387 tests, 0 failures.
- Новые тесты: `src/telegram/channel-peer-cache.spec.ts`, `src/telegram/channel.service.spec.ts`; дополнены `telegram.service.spec.ts`, `utils/telegram-errors.spec.ts`.
- Повторное чтение канала не вызывает `getInputEntity`; устаревшая запись — один повторный поиск; отказ Redis не меняет ответ.
- Лог flood wait: `Posts: @channel failed: 429 (FLOOD_WAIT_N)`.
