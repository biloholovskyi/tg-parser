# Phase 03 — Сводка по оригиналам, модель перевода, обрезка постов (Часть А)

## Статус

done

## Правила

`.claude/rules/patterns.md`, `.claude/rules/testing.md`, `.claude/rules/runtime-resources.md`

## Цель

Дайджест по умолчанию не переводит посты целиком, перевод выполняет настраиваемая дешёвая модель, а лог показывает расход токенов по этапам.

## Подсказки по реализации

- Модель перевода по умолчанию выбирается по docs.x.ai: самая дешёвая доступная модель с поддержкой `response_format: json_schema`. Дата проверки пишется в комментарии константы, как у `GROK_MODEL_DEFAULT`.
- Разбор режима и уровня рассуждений перевода повторяет `parseReasoningEffort`; общий разбор выносится в одну функцию.
- Перевод резервных тезисов — отдельный метод `TranslationService` с одним запросом.

## Объём

- `src/config/digest.config.ts`: `DIGEST_TRANSLATION` (`off` | `on`, по умолчанию `off`), `GROK_TRANSLATION_MODEL`, `GROK_TRANSLATION_REASONING_EFFORT` (по умолчанию `off`); неизвестное значение — значение по умолчанию и одно предупреждение.
- `src/digest/grok/grok.client.ts`: `GrokJsonRequest` с необязательными `model`, `reasoningEffort` и `meter`; `usage` каждого ответа уходит в `GrokUsageMeter`.
- `src/digest/grok/prompts.ts`: сводка и дополнение принимают посты на любом языке и пишут тезисы и `claim` по-русски.
- `src/digest/translation.service.ts`: модель и рассуждения перевода; метод перевода резервных тезисов.
- `src/digest/digest.service.ts`: в режиме `off` перевод пропускается, сводка получает оригиналы, резервные тезисы переводятся после сводки.
- `src/digest/summary.service.ts` и `src/digest/utils/post-selection.ts`: резервные блоки получают текст для последующего перевода.
- `src/digest/constants.ts`: `DIGEST_POST_MAX_CHARS` = 1200.
- Строка лога за этап: модель и суммы `prompt_tokens`, `completion_tokens`, `reasoning_tokens`.
- Тесты: разбор трёх переменных, выбор модели в теле запроса, оба режима в `DigestService`, перевод резервных тезисов и его отказ, учёт `usage`, новые промпты.

## Чек-лист

- [ ] Конфигурация и тесты
- [ ] `GrokClient`: модель на запрос, `usage`, тесты
- [ ] Промпты и тесты
- [ ] Режимы `off` и `on` в `DigestService` и тесты
- [ ] Перевод резервных тезисов и тесты
- [ ] `DIGEST_POST_MAX_CHARS` = 1200

## Проверка

- `rtk npm run lint`
- `rtk npm run build`
- `rtk npm test`

## Критерии приёмки

- В режиме `off` за запуск нет запросов перевода, кроме одного для резервных тезисов, если они есть.
- В режиме `on` перевод идёт моделью из `GROK_TRANSLATION_MODEL`, сводка — моделью из `GROK_MODEL`.
- Тезисы приходят по-русски при украинских и английских оригиналах (проверка на смоук-запуске в Finalize).
- Лог запуска показывает расход токенов по этапам.

## Evidence

- lint, build зелёные; `rtk npm test`: 66 suites, 1497 tests, 0 failures.
- Новый тест `src/digest/grok/grok-usage.spec.ts`; дополнены спеки конфига, Grok-клиента, перевода, сводки, сервиса дайджеста, промптов.
- Модель перевода по умолчанию: `grok-4.20-0309-non-reasoning` (docs.x.ai, 14.10.2026); поддержка `json_schema` проверяется на смоук-запуске.
- В режиме `off` `translate` не вызывается; резервные тезисы переводятся одним механизмом с переводом постов.
