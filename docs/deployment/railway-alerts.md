# Алерты на Railway: подключение TechAdminServer

`tg-parser` отправляет алерты в TechAdminServer, а тот доставляет их в Telegram-чат. Маршрут `POST /alerts`, тело `CreateAlertDto` (`serviceName`, `level`, `message`, `details`); поля описаны в `docs/plans/block-11-alerts/research.md`.

## Что приходит

- `info` — успешный логин через `POST /telegram/auth` (Telegram id, username, был ли 2FA, сохранилась ли сессия), восстановление связи с Redis.
- `warning` — flood wait от Telegram, сессия не сохранилась в Redis, дайджест ушёл с потерями или пропущен, дайджест выключен, неполная конфигурация при старте.
- `error` — Telegram недоступен или ответил 5xx (для постов один алерт на все каналы, имя канала в `details`), потеря связи с Redis, сбой дайджеста, сбой регистрации расписания, необработанные ошибки процесса, сбой старта.

Одинаковые `warning` и `error` уходят не чаще раза в 10 минут; следующий алерт сообщает число пропущенных повторов в `details.suppressedRepeats`. Телефон, код, пароль, строка сессии и ключи в алерт не попадают.

## Шаг 1. Получить ключ

Ключ для заголовка `X-API-Key` выдаёт администратор TechAdminServer. Это секрет: только в переменных окружения, никогда в коде и в чатах.

## Шаг 2. Задать переменные в `tg-parser`

В Railway: сервис `tg-parser` → Variables.

| Переменная | Значение |
|------------|----------|
| `ALERTS_URL` | `https://tech-adming-back-production.up.railway.app` |
| `ALERTS_API_KEY` | ключ из шага 1 |
| `ALERTS_SERVICE_NAME` | необязательно, по умолчанию `tg-parser` |

`ALERTS_URL` должен быть `https://`; `http://` принимается только для `localhost` и `*.railway.internal`. Адрес с логином, параметрами или `#` отклоняется, и алерты выключаются.

Railway перезапустит сервис сам.

## Шаг 3. Проверить

- В логе старта нет строки `Alerts disabled`.
- Если конфигурация неполная, в чат алертов приходит `Incomplete configuration at boot`.
- Логин через `POST /telegram/auth` даёт `info` `New Telegram login`.
- В TechAdminServer у алерта статус доставки `sent`.

## Локальная разработка

Те же переменные в `.env` (правится вручную). Без них алерты выключены, в логе одно предупреждение `Alerts disabled`, остальное работает. E2E-тесты всегда запускаются с выключенными алертами.

## Типовые ошибки

- `Alert not delivered: HTTP 401` в логе — неверный `ALERTS_API_KEY`.
- `Alert not delivered: timeout` или `network error` — TechAdminServer недоступен; основной сервис работает, алерты за это время теряются.
- Строка об ошибке доставки пишется не чаще раза в 10 минут.

## Откат

Удалить `ALERTS_URL` или `ALERTS_API_KEY` в Railway: после перезапуска алерты выключены, код не меняется.
