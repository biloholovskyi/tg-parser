# Блок 11 — Исследование: интеграция алерт-сервиса

Только факты. Решения — в [design.md](design.md).

## Внешний сервис (TechAdminServer)

- Контракт: `swagger.json`, переданный пользователем (версия API 0.2.0); в репозиторий не входит, нужные поля перенесены сюда.
- Базовый адрес: `https://tech-adming-back-production.up.railway.app/`.
- Приём алерта: `POST /alerts`, заголовок `X-API-Key`, ответ 202 `AlertAcceptedResponse` (`id`, `createdAt`, `deliveryStatus`), 401 при неверном ключе.
- Тело `CreateAlertDto`:

| Поле | Тип | Ограничение |
|------|-----|-------------|
| `serviceName` | string | обязательное, до 100 символов |
| `level` | `info` / `warning` / `error` | обязательное |
| `message` | string | обязательное, до 4000 символов |
| `details` | object | необязательное, свободный контекст, в Telegram показывается свёрнутым блоком |

- Доставка в Telegram и повторы — на стороне сервиса (`deliveryStatus`, `deliveryAttempts`); нашему сервису достаточно получить 202.
- Остальные маршруты (`/auth/*`, `GET /alerts`, `/railway/*`) требуют JWT и для интеграции не нужны.
- Лимит частоты на `POST /alerts` в контракте не описан.

## Решения пользователя

- Целевая версия: 1.5.1.
- Info-алерт: на каждый успешный логин через `POST /telegram/auth` (выдача новой сессии), без телефона — только Telegram id и username.
- Алерты warning/error: во всех критических местах (перечень ниже).

## Критические точки в коде

| Место | Файл | Что происходит |
|-------|------|----------------|
| Необработанный reject | `src/shared/utils/process-handlers.ts` | лог `Unhandled promise rejection`, процесс живёт |
| Необработанное исключение | `src/shared/utils/process-handlers.ts` | лог и завершение процесса через `closeApplication` |
| Ошибка при остановке | `src/shared/utils/process-handlers.ts` | лог `Error during shutdown` |
| Сбой старта | `src/main.ts` | лог и `process.exit` до появления приложения |
| Потеря связи с Redis | `src/redis/redis-client.ts` | одна строка на сбой, одна на восстановление |
| Сессия не сохранена в Redis | `src/telegram/session-store.ts` (`adopt`) | логин работает до перезапуска |
| Сбой Telegram 5xx и flood wait 429 | `src/telegram/utils/telegram-errors.ts` (`failWith`) | одна итоговая строка на запрос |
| Нет `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | `src/telegram/utils/telegram-errors.ts` (`missingConfigException`) | 500 при первом использовании |
| Дайджест упал | `src/digest/digest.service.ts` (`reportFailure`) | лог, уведомление в чат бота |
| Уведомление о сбое не доставлено | `src/digest/digest.service.ts` | лог |
| Саммари в режиме запасного варианта | `src/digest/digest.service.ts` (`buildReport`) | посты уходят без группировки |
| Каналы недоступны, посты не переведены | `src/digest/post-collector.ts`, `src/digest/translation.service.ts` | отражено в отчёте дайджеста |
| Плановый запуск пропущен | `src/digest/digest.service.ts` (`runScheduled`) | предыдущий запуск ещё идёт |
| Расписание не зарегистрировано | `src/digest/digest.scheduler.ts` | ежедневного дайджеста не будет |
| Неполная конфигурация при старте | `src/config/*.config.ts` | предупреждения в лог: пустой `API_KEYS`, нет Redis, дайджест выключен, нет Telegram API |

## Точка успешного логина

- `AuthService.completeLogin` (`src/telegram/auth.service.ts`) — единственное место выдачи новой сессии, с 2FA и без.
- `Api.auth.SignIn` и `Api.auth.CheckPassword` возвращают `auth.Authorization` с объектом пользователя: id и username доступны без лишнего вызова MTProto.

## Ограничения

- Секреты не покидают сервис: `sessionString`, телефон, код, 2FA-пароль, `TELEGRAM_API_HASH`, токен бота, ключ Grok (`.claude/rules/telegram.md`). Алерт — это данные, отправленные наружу, поэтому правило действует и для него.
- `describeError` (`src/shared/utils/process-handlers.ts`, `src/telegram/utils/telegram-errors.ts`) даёт описание ошибки без полезной нагрузки запроса.
- `BotError` и `GrokError` уже не содержат URL и ключей.
- Каждый внешний вызов — с именованным таймаутом и очищаемым таймером; каждый ресурс — с потолком (`.claude/rules/runtime-resources.md`).
- GramJS не выходит за `src/telegram/`; Redis-клиент создаётся только в `src/redis/redis-client.ts`.
- Конфиг-загрузчики в `src/config/` — простые функции без DI; `registerProcessHandlers` и `createRedisClient` тоже не участвуют в DI.
- Глобальный `fetch` Node 20 уже используется в `BotNotifier`; `undici` есть в зависимостях.
- Старт не падает из-за отсутствующих переменных окружения.

## Открытые вопросы

- Нет. API-ключ алерт-сервиса пользователь задаёт в окружении Railway сам.
