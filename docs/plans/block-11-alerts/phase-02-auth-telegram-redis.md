# Phase 02 — Логин, Telegram и Redis

Статус: done

Правила: `.claude/rules/telegram.md`, `.claude/rules/runtime-resources.md`, `.claude/rules/architecture.md`, `.claude/rules/testing.md`.

## Цель

Info-алерт на каждый успешный логин и warning/error-алерты на сбои Telegram, сохранения сессии и связи с Redis.

## Заметки к реализации

- Фаза идёт раньше дайджеста: она меняет поток авторизации, самый рискованный путь.
- `submitCode` и `checkPassword` в `src/telegram/auth.service.ts` возвращают пользователя из `auth.Authorization`; из него берутся только `id` (строкой) и `username`. Телефон, имя и фамилия не читаются.
- `SessionStore.adopt` возвращает `sessionString` и признак `isPersisted`; вызовы `adopt` правятся под новую форму.
- `failWith` получает четвёртый необязательный параметр `alerts?: AlertSink`. Ключ подавления дублей — операция и статус, поэтому сотня одинаковых 503 даёт один алерт в окне.
- `createRedisClient` получает необязательный колбэк `onConnectionChange(isUp, reason)`; срабатывает на тех же переходах, что и строки лога, не на каждую попытку переподключения.

## Объём

- `src/telegram/auth.service.ts` — после `adopt` в `completeLogin`: `alerts.info` с `userId`, `username`, `has2fa`, `isPersisted`. Неудачный логин алерта не даёт, кроме 5xx и 429 через `failWith`.
- `src/telegram/session-store.ts` — `adopt` возвращает `{ sessionString, isPersisted }`; при неудаче сохранения `alerts.warning('Session not persisted', { reason })`.
- `src/telegram/utils/telegram-errors.ts` — `failWith`: статус от 500 и выше даёт `error`, 429 даёт `warning`, остальное без алерта; в `details` операция, статус и `describeError`.
- `src/telegram/auth.service.ts`, `src/telegram/channel.service.ts`, `src/telegram/telegram.service.ts` — передают `AlertService` в каждый вызов `failWith`.
- `src/redis/redis-client.ts` — колбэк состояния соединения.
- `src/redis/redis.module.ts` — фабрика клиента внедряет `AlertService`: потеря связи даёт `error`, восстановление даёт `info`.
- Обновлённые и новые тесты рядом с файлами; E2E `test/*.e2e-spec.ts` подменяет `AlertService` поддельным провайдером.

## Чек-лист

- [x] Логин без 2FA: один `info` с `userId`, `username`, `has2fa: false`, `isPersisted`
- [x] Логин с 2FA: один `info` с `has2fa: true`
- [x] Тест: `details` логин-алерта не содержат поддельных телефона, кода, пароля и сессии из фикстуры (проверка сериализованного вызова)
- [x] Шаг запроса кода и шаг «нужен пароль» алерта не дают
- [x] Неудача Redis при `adopt`: логин успешен, `warning` отправлен, `info` содержит `isPersisted: false`
- [x] `failWith`: 503 и 502 дают `error`, 429 даёт `warning`, 400, 401 и 404 не дают алерта; без приёмника возвращает то же исключение и ту же строку лога
- [x] Redis: обрыв даёт один `error` на сбой, восстановление один `info`, серия ошибок подряд — один алерт
- [x] Исключение в `AlertService` не ломает логин (подделка, которая бросает)
- [x] E2E полностью зелёные с поддельным `AlertService`, реальных запросов к алерт-сервису нет
- [x] Тесты написаны агентом `test-writer`

## Команды проверки

- `rtk npm.cmd run typecheck`
- `rtk npm.cmd run lint`
- `rtk npm.cmd test -- src/telegram src/redis`
- `rtk npm.cmd run test:e2e`

## Критерии приёмки

- Все команды выше зелёные.
- `rtk rg "alerts\.(info|warning|error)" src/telegram src/redis` находит вызовы в `auth.service.ts`, `session-store.ts`, `redis.module.ts`, а `failWith` вызывает приёмник.
- Тест логин-алерта проверяет точный набор ключей `details`: `userId`, `username`, `has2fa`, `isPersisted` и ничего больше.
- Тест: логин завершается, когда подделка `AlertService` возвращает никогда не завершающийся промис.

## Передача следующей фазе

`failWith` и Redis уже алертят; дайджест, процесс и конфигурация остаются для Phase 03.

## Доказательства

- `rtk npm.cmd run typecheck` и `rtk npm.cmd run lint` без ошибок.
- `rtk npm.cmd test -- src/telegram src/redis`: 14 наборов, 518 тестов зелёные; весь unit-набор — 1155 тестов.
- `rtk npm.cmd run test:e2e`: 5 наборов, 68 тестов зелёные; `fetch` за прогон не вызывается.
- Вызовы алертов: `auth.service.ts`, `session-store.ts`, `redis.module.ts`, `failWith` через приёмник.
- Ключи логин-алерта ровно `userId`, `username`, `has2fa`, `isPersisted`; телефона, кода, пароля и сессии нет ни в одном вызове.
- Отличие от плана: в E2E `AlertService` не подменяется, вместо этого `test/setup-env.ts` обнуляет `ALERTS_URL` и `ALERTS_API_KEY`. Пункт «исключение не ломает логин» обеспечен внутри `AlertService.enqueue` (тест в Phase 01), сами точки вызова не оборачиваются.
