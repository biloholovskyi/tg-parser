# Phase 03 — Дайджест, процесс и конфигурация

Статус: done

Правила: `.claude/rules/runtime-resources.md`, `.claude/rules/architecture.md`, `.claude/rules/patterns.md`, `.claude/rules/testing.md`.

## Цель

Алерты на сбои дайджеста, падения и остановку процесса, сбой старта и неполную конфигурацию.

## Заметки к реализации

- Грок-клиент сам не алертит: его сбой виден в итоговом алерте запуска дайджеста, иначе на один сбой придёт несколько сообщений.
- `registerProcessHandlers(app, alerts)`: при `uncaughtException` алерт ставится в очередь до `closeApplication`, а `AlertsModule.onApplicationShutdown` отправляет его в пределах ALERT_DRAIN_TIMEOUT_MS.
- Сбой старта в `src/main.ts` случается до появления приложения: `getAlertsConfig()` и `sendAlert` вызываются напрямую, ожидание не дольше ALERT_CALL_TIMEOUT_MS, затем `process.exit`.
- Конфиг-загрузчики не меняют свои строки лога; для `BootConfigReporter` они экспортируют чистые проверки: `hasTelegramCredentials`, `hasApiKeys`, `isSessionPersistenceConfigured`, `isDigestConfigured` (имена уточняются по коду).

## Объём

- `src/digest/digest.service.ts`:
  - `reportFailure`: `error` с триггером, статусом и причиной из FAILURE_REASONS или именем ошибки; при недоставленном уведомлении в бота — второй `error`.
  - `execute`: после успешной отправки один `warning`, если есть хотя бы одно из: `isSummaryFallback`, недоступные каналы, обрезанные каналы, непереведённые посты, пропущенные из-за DIGEST_MAX_POSTS; в `details` все счётчики и имена недоступных каналов.
  - `runScheduled`: `warning` о пропуске.
- `src/digest/digest.scheduler.ts` — `error`, если расписание не зарегистрировано.
- `src/shared/utils/process-handlers.ts` — `error` на `unhandledRejection` и `uncaughtException`, `warning` на ошибку при остановке; параметр `alerts: AlertSink`.
- `src/main.ts` — передаёт `app.get(AlertService)` в `registerProcessHandlers`; прямой алерт при сбое старта.
- `src/alerts/boot-config-reporter.ts` — провайдер с `onApplicationBootstrap`: один `warning` со списком имён проблемных переменных, если что-то не задано; ничего, если всё в порядке.
- `src/config/telegram.config.ts`, `src/config/api-keys.config.ts`, `src/config/redis.config.ts`, `src/config/digest.config.ts` — экспорт чистых проверок.
- Тесты рядом с файлами.

## Чек-лист

- [x] Запуск дайджеста с 401 от коллектора: один `error` с причиной, без строки сессии
- [x] Недоставленное уведомление о сбое: второй `error`
- [x] Запуск с запасным саммари и недоступным каналом: один `warning` со счётчиками
- [x] Чистый запуск без потерь: алертов нет
- [x] Пропуск планового запуска: `warning`
- [x] Неверный `DIGEST_CRON`: `error` при старте
- [x] `unhandledRejection` и `uncaughtException`: `error`; после reject процесс продолжает работу, после исключения закрывается через `closeApplication`
- [x] Сбой старта: прямая отправка вызвана, `process.exit` вызван даже при зависшей отправке (поддельные таймеры)
- [x] `BootConfigReporter`: один алерт с именами переменных без значений; при полной конфигурации алертов нет
- [x] Тест: ни один `details` в этой фазе не содержит токена бота, ключа Grok и строки сессии из фикстур
- [x] Тесты написаны агентом `test-writer`

## Команды проверки

- `rtk npm.cmd run typecheck`
- `rtk npm.cmd run lint`
- `rtk npm.cmd test`
- `rtk npm.cmd run test:e2e`

## Критерии приёмки

- Все команды выше зелёные.
- Каждая строка карты алертов из [design.md](design.md) покрыта тестом; соответствие отмечено в `history.md`.
- `rtk rg "alerts\." src/digest/grok` ничего не находит.

## Передача следующей фазе

Все точки из карты алертов подключены; Finalize проверяет на живом сервисе.

## Доказательства

- `rtk npm.cmd run typecheck` и `rtk npm.cmd run lint` без ошибок.
- `rtk npm.cmd test`: 60 наборов, 1231 тест зелёные; `rtk npm.cmd run test:e2e`: 5 наборов, 68 тестов зелёные.
- Каждая строка карты алертов покрыта тестом, соответствие записано в `history.md`.
- `alerts.` в `src/digest/grok` не встречается.
- Отличие от плана: алерт «дайджест выключен» шлёт `DigestScheduler`, а не `BootConfigReporter`, потому что разобранный конфиг дайджеста есть только у него.
- Ограничение: алерт «Error during shutdown» работает по принципу «как получится»: он ставится в очередь после `app.close()` и обычно не успевает уйти.
