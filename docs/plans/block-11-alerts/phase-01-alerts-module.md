# Phase 01 — Модуль алертов

Статус: done

Правила: `.claude/rules/architecture.md`, `.claude/rules/runtime-resources.md`, `.claude/rules/telegram.md` (секреты), `.claude/rules/patterns.md`, `.claude/rules/testing.md`.

## Цель

Глобальный `AlertService`, который безопасно и без ожидания отправляет алерты в TechAdminServer и ничего не ломает, когда тот недоступен или не настроен.

## Заметки к реализации

- Модуль пишется с нуля по раскладке из [design.md](design.md).
- Отправка — глобальный `fetch` с `AbortController` и очищаемым таймером, как в `src/digest/bot-notifier.ts`.
- Адрес `POST /alerts` собирается из `ALERTS_URL` без двойного слэша; ключ только в заголовке `X-API-Key`.
- `sleep` и паттерн повторов не копировать из `BotNotifier` построчно: повтор здесь ровно один.
- В этой фазе нет ни одной точки вызова вне модуля.

## Объём

- `src/config/alerts.config.ts` — `getAlertsConfig()`: `url`, `apiKey`, `serviceName` (по умолчанию `tg-parser`, обрезается до ALERT_SERVICE_NAME_MAX_CHARS), `isEnabled`; одно предупреждение с именами отсутствующих переменных, без значений.
- `src/alerts/constants.ts` — ALERT_CALL_TIMEOUT_MS, ALERT_MAX_RETRIES, ALERT_QUEUE_MAX_SIZE, ALERT_MAX_CONCURRENT, ALERT_DEDUP_WINDOW_MS, ALERT_DEDUP_MAX_KEYS, ALERT_DRAIN_TIMEOUT_MS (меньше SHUTDOWN_TIMEOUT_MS), ALERT_MESSAGE_MAX_CHARS, ALERT_SERVICE_NAME_MAX_CHARS, ALERT_DETAILS_MAX_CHARS, ALERT_DETAILS_MAX_DEPTH, ALERTS_CONFIG (токен провайдера).
- `src/alerts/interfaces/alert.interface.ts` — `AlertLevel`, `AlertDetails`, `AlertPayload`, `AlertSink` (методы `info`, `warning`, `error`).
- `src/alerts/alert-sanitizer.ts` — чистые функции санитизации `message` и `details` по правилам из [design.md](design.md).
- `src/alerts/alert-sender.ts` — `sendAlert(config, payload)`: один запрос, таймаут, один повтор на сеть, таймаут и 5xx; бросает ошибку без URL, ключа и тела.
- `src/alerts/alert.service.ts` — реализация `AlertSink`: очередь, параллелизм, подавление дублей, счётчики отброшенных и подавленных, одна строка лога на неудачу, `onApplicationShutdown` с ожиданием очереди.
- `src/alerts/alerts.module.ts` — `@Global()`, провайдеры конфига и сервиса, экспорт `AlertService`.
- `src/app.module.ts` — импорт `AlertsModule` первым, до `TelegramModule`.
- Тесты рядом с каждым файлом.

## Чек-лист

- [x] Загрузчик конфига и его тесты: включён, выключен без URL, выключен без ключа, имя сервиса по умолчанию и обрезка
- [x] Санитизатор и тесты: обрезка `message`, запрещённые ключи удалены, поддельная строка вида `StringSession` и поддельный телефон заменены на `[redacted]`, глубина и длина `details` ограничены
- [x] Отправитель и тесты: заголовок `X-API-Key`, тело по `CreateAlertDto`, повтор на 503 и сетевую ошибку, нет повтора на 401 и 400, таймаут прерывает запрос и таймер очищен (поддельные таймеры), текст ошибки без ключа и URL
- [x] Сервис и тесты: вызов возвращается сразу, исключение отправителя не выходит наружу, переполнение очереди отбрасывает и считает, не более ALERT_MAX_CONCURRENT запросов одновременно, дубль в окне подавлен и посчитан, info не подавляется, карта дублей не растёт выше ALERT_DEDUP_MAX_KEYS, выключенный сервис не делает запросов, остановка ждёт не дольше ALERT_DRAIN_TIMEOUT_MS
- [x] Модуль подключён в `AppModule`, приложение стартует без переменных алертов
- [x] Тесты написаны агентом `test-writer`

## Команды проверки

- `rtk npm.cmd run typecheck`
- `rtk npm.cmd run lint`
- `rtk npm.cmd test -- src/alerts src/config/alerts.config`

## Критерии приёмки

- Все тесты из команд выше зелёные.
- `rtk rg "fetch\(" src/alerts` находит вызов только в `alert-sender.ts`.
- `rtk rg "apiKey" src/alerts --glob "!*.spec.ts"` не находит его ни в одной строке лога.
- В `src/alerts/` нет импорта пакета `telegram`.

## Передача следующей фазе

`AlertService` и интерфейс `AlertSink` доступны для внедрения в любом модуле без импорта `AlertsModule`.

## Доказательства

- `rtk npm.cmd run typecheck` и `rtk npm.cmd run lint` без ошибок.
- `rtk npm.cmd test -- src/alerts src/config/alerts.config`: 6 наборов, 103 теста, все зелёные.
- `fetch(` в `src/alerts` только в `alert-sender.ts`; `apiKey` не попадает ни в одну строку лога; импорта `telegram` нет.
- По находкам `test-writer` исправлено: запрос с уже прерванным сигналом не отправляется; запрещённые ключи ищутся по вхождению (`X-API-Key`, `accessToken`, `clientSecret`); после остановки отказ отправки не пишется в лог. На каждое есть регрессионный тест.
- Дополнительно к объёму: `src/alerts/utils/alert-deduplicator.ts` вынесен из сервиса.
