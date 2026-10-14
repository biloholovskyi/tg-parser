# Исследование — блок 12

Только факты, без решений.

## Инцидент 12.10.2026

- Плановый запуск в 20:00 UTC (23:00 Europe/Kyiv). Каналы до `@sanya_florida` прочитаны, на `@truexanewsua` — `429 (FLOOD)`, затем `Digest scheduled failed: 429`, в бот ушло сообщение об ошибке.
- Всё произошло в пределах одной секунды: аккаунт не делал в этот момент много запросов, лимит был исчерпан раньше.
- GramJS для любого flood wait кладёт в `errorMessage` строку `FLOOD`, а число секунд — в поле `seconds` (`node_modules/telegram/errors/RPCErrorList.js`, `FloodWaitError`). `describeError` в `src/telegram/utils/telegram-errors.ts` пишет только `errorMessage`, поэтому длительность ожидания в лог не попала.
- Ожидание не длиннее `FLOOD_SLEEP_THRESHOLD_S` GramJS выдерживает сам; значит, Telegram просил ждать дольше.

## Сбор постов

- `ChannelService.openWalk` (`src/telegram/channel.service.ts`) вызывает `client.getInputEntity(channelUsername)`. У свежего клиента в памяти нет сущности канала, и GramJS выполняет `contacts.ResolveUsername` — запрос с жёстким суточным лимитом на аккаунт.
- Клиент дайджеста выселяется из `SessionClientCache` через `SESSION_CACHE_IDLE_TTL_MS` простоя, а `StringSession` не сохраняет сущности. Поэтому каждый вечерний запуск ищет по имени все каналы из `DIGEST_CHANNELS`.
- `PostCollector` (`src/digest/post-collector.ts`) читает каналы по одному; статусы 401, 429, 503 (`RUN_FATAL_STATUSES`) прерывают весь запуск.
- `failWith` превращает ошибку в `TooManyRequestsException` (`src/shared/exceptions/too-many-requests.exception.ts`), у которого есть `retryAfterSeconds`.
- `SessionRepository` (`src/telegram/session-repository.ts`) — образец работы с Redis: `REDIS_CLIENT` может быть `null` (режим только памяти), ключи с префиксом `tg:`, ключ сессии — SHA-256 через `hashSecret` (`src/shared/utils/secret-cipher.ts`).
- Ошибки «канал недоступен» перечислены в `CHANNEL_UNAVAILABLE_ERRORS` (`src/telegram/constants.ts`).

## Стоимость Grok

- `TranslationService` переводит все посты с текстом пакетами по `GROK_TRANSLATE_BATCH_CHARS`, каждый пост обрезан до `DIGEST_POST_MAX_CHARS` (1500). Модель возвращает полный текст по-русски — весь объём оплачивается как выходные токены.
- Переведённый текст используется только как вход сводки (`summaryInputOf`, обрезка `SUMMARY_POST_MAX_CHARS`) и как тезис резервных блоков (`postsAsTopics` в `src/digest/utils/post-selection.ts`, `fallbackTopic` в `src/digest/summary.service.ts`, обрезка `DIGEST_FALLBACK_THESIS_CHARS`). После сводки он не нужен.
- `GrokClient.buildBody` (`src/digest/grok/grok.client.ts`) берёт модель и `reasoning_effort` из `DigestConfig` — одни на все запросы. Использование токенов из ответа (`usage`) не читается и не логируется.
- `GROK_REASONING_EFFORT` по умолчанию `low`: рассуждения оплачиваются и при переводе.
- Цены xAI по сторонним обзорам (октябрь 2026): самая дешёвая линейка — Grok 4.1 Fast, около $0.20 вход и $0.50 выход за миллион токенов; её доступность не подтверждена официальной страницей. Модель по умолчанию для перевода выбирается по docs.x.ai при реализации.

## Ограничения

- GramJS только в `src/telegram/`; дайджест читает каналы только через `TelegramService.readPostsAsDigestAccount`.
- Каждый таймер очищается, каждый кэш ограничен (`.claude/rules/runtime-resources.md`).
- Сессия и любые её производные, кроме SHA-256, не попадают в Redis-ключи, логи и алерты.

## Открытые вопросы

- Точное имя дешёвой модели xAI и её поддержка `response_format: json_schema` — проверить в Phase 03.
