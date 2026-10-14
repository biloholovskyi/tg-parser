# Дизайн — блок 12

## Часть Б. Кэш каналов

- Новый класс `ChannelPeerCache` (`src/telegram/channel-peer-cache.ts`) хранит для пары «аккаунт + имя канала» числовой `channelId` и `accessHash` — всё, что нужно, чтобы обратиться к каналу без поиска по имени.
- Ключ Redis: `tg:peer:{sha256(sessionString)}:{username в нижнем регистре}`, значение — JSON `{ channelId, accessHash }` строками. Срок жизни `CHANNEL_PEER_TTL_S` (30 дней), продлевается при использовании.
- Без Redis — ограниченный кэш в памяти на `CHANNEL_PEER_CACHE_MAX_ENTRIES` записей с вытеснением самой старой.
- Ошибка Redis при чтении или записи кэша не срывает запрос: кэш считается пустым, одна строка warn на вызов.
- `ChannelService.openWalk`: сначала кэш; при попадании — `Api.InputPeerChannel` из сохранённых значений; при промахе — `getInputEntity`, и если результат `InputPeerChannel`, он записывается в кэш.
- Если запрос по сохранённым значениям получил ошибку из `CHANNEL_UNAVAILABLE_ERRORS` или `CHANNEL_PEER_STALE_ERRORS` (`CHANNEL_INVALID`, `PEER_ID_INVALID`), запись удаляется и выполняется один повторный поиск по имени.
- Кэш используется любым чтением каналов (REST и дайджест), потому что живёт в `ChannelService`.

## Часть Б. Время ожидания в логе

- `describeError` для ошибки с числовым `seconds` и кодом `FLOOD` возвращает `FLOOD_WAIT_{seconds}`. Строки лога и алерта показывают длительность.

## Часть Б. Ожидание и продолжение сбора

| Ситуация в `PostCollector` | Действие |
|----------------------------|----------|
| 429, `retryAfterSeconds` не больше `DIGEST_FLOOD_WAIT_MAX_S` (30 мин), суммарное ожидание за запуск не превышает `DIGEST_FLOOD_WAIT_TOTAL_MAX_S` (60 мин) | ждать `retryAfterSeconds + DIGEST_FLOOD_WAIT_MARGIN_S`, повторить тот же канал |
| 429 сверх любого из пределов | запуск прерывается, в бот уходит сообщение «Telegram ограничил частоту запросов» |
| 401, 503 | запуск прерывается |
| остальные ошибки канала | канал пропускается и попадает в `unavailableChannels` |

- Ожидание — через отменяемую паузу: таймер очищается при завершении, `unref()`; `onModuleDestroy` дайджеста отменяет паузу, запуск завершается без отправки.
- Каждое ожидание — одна строка warn и `alerts.warning('Digest waiting for Telegram flood limit', { channel, seconds })`.
- Пока запуск ждёт, флаг «запуск идёт» остаётся поднятым: `POST /digest/run` отвечает 409.

## Часть А. Режимы перевода

| `DIGEST_TRANSLATION` | Перед сводкой | Вход сводки | Тезисы резервных блоков |
|----------------------|---------------|-------------|-------------------------|
| `off` (по умолчанию) | ничего | оригиналы, обрезка `SUMMARY_POST_MAX_CHARS` | перевод только этих тезисов моделью перевода |
| `on` | `TranslationService` переводит все посты моделью перевода | переводы, обрезка `SUMMARY_POST_MAX_CHARS` | из переводов |

- `DigestConfig` получает `translationMode`, `grokTranslationModel`, `grokTranslationReasoningEffort`. Неизвестное значение — значение по умолчанию и одно предупреждение, как у `GROK_REASONING_EFFORT`.
- `GrokJsonRequest` получает необязательные `model`, `reasoningEffort` и `meter`; без них — основные настройки. `TranslationService` и перевод тезисов передают настройки перевода.
- `SUMMARY_SYSTEM_PROMPT` и `SUMMARY_COVERAGE_SYSTEM_PROMPT`: посты могут быть на любом языке; тезисы и `viewpoints.claim` всегда по-русски, имена и цифры сохраняются.
- Перевод тезисов резервных блоков: `TranslationService.translateTheses` тем же механизмом, промптом `TRANSLATION_SYSTEM_PROMPT` и схемой, что и перевод постов; тезисы короткие (`DIGEST_FALLBACK_THESIS_CHARS`), поэтому обычно это один запрос. Не удалось — тезис остаётся оригиналом и считается в `untranslatedCount`.
- В режиме `off` `untranslatedCount` считает только непереведённые резервные тезисы; строка подвала «Без перевода» остаётся.
- `DIGEST_POST_MAX_CHARS` = 1200.

## Часть А. Учёт токенов

- `GrokClient` читает `usage` из каждого полученного ответа (`prompt_tokens`, `completion_tokens`, `completion_tokens_details.reasoning_tokens`) и добавляет его в `GrokUsageMeter` из запроса (`src/digest/grok/grok-usage.ts`).
- Этапы `translation`, `summary`, `fallback-translation` логируют по одной строке за запуск с суммой токенов; строки перевода называют ещё и модель перевода, сводка идёт на `GROK_MODEL`. Это нужно, чтобы проверить экономию на настоящем запуске.

## Поток запуска

```
collect (кэш каналов, ожидание лимита)
  -> limitPosts
  -> [on] translate(модель перевода)
  -> summarize(основная модель, оригиналы или переводы)
  -> [off] перевод резервных тезисов(модель перевода)
  -> format -> send
```
