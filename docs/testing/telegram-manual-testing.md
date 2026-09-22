# Ручное тестирование — модуль telegram

Артефакт к блоку 01 (загрузка приложения). Покрывает REST-поверхность после подключения глобальной валидации, ограничения размера тела и списка разрешённых источников CORS.

Парный файл для Postman: [telegram-postman-collection.json](telegram-postman-collection.json).

## Предусловия

- Сервис собран и запущен: `rtk npm run build`, затем `rtk npm run start:prod`.
- Переменные окружения: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `PORT` (по умолчанию 8080), `CORS_ALLOWED_ORIGINS` (список источников через запятую; пустое значение запрещает все браузерные источники).
- Базовый адрес в примерах: `http://127.0.0.1:8080`.

## Модель авторизации

- Аутентификация вызывающей стороны на уровне сервиса ещё не включена — это блок 02. Сейчас все маршруты открыты.
- `sessionString` — полномочия на весь аккаунт Telegram. Хранить только в переменной Postman, никогда не коммитить и не писать в отчёты.
- Получение: `POST /telegram/auth` в два или три шага — телефон, затем код из SMS, при включённой двухфакторной защите ещё и пароль. Ответ последнего шага содержит `sessionString`.
- Передача: сейчас `sessionString` идёт в query-параметре у `GET /telegram/me` и у постов канала. Это нарушение `.claude/rules/api-security.md`, запланированное к исправлению в блоке 02; артефакт описывает фактическое поведение.

## Осторожно

Шаг с реальным номером телефона заставляет Telegram отправить SMS и расходует лимиты приложения. Негативные случаи ниже составлены так, чтобы запрос отклонялся валидацией до обращения к Telegram.

## Случаи

### Health

| № | Запрос | Ожидаемый результат |
|---|--------|---------------------|
| H1 | `GET /telegram/health` | 200, ровно `{"status":"ok"}`, без обращения к Telegram |
| H2 | `GET /telegram/health` без переменных `TELEGRAM_API_ID` и `TELEGRAM_API_HASH` | 200, тот же ответ |
| H3 | `GET /` | 404 (дублирующий health удалён) |
| H4 | `GET /health` | 404 (дублирующий health удалён) |

### Валидация тела запроса

| № | Запрос | Ожидаемый результат |
|---|--------|---------------------|
| V1 | `POST /telegram/auth`, тело `{"phoneNumber":"not-a-phone","unexpectedField":"x"}` | 400, сообщения `property unexpectedField should not exist` и про формат E.164, обращения к Telegram нет |
| V2 | `POST /telegram/auth`, тело `{}` | 400, `phoneNumber` обязателен |
| V3 | `POST /telegram/auth`, тело `{"phoneNumber":"not-a-phone"}` | 400, формат номера |
| V4 | `POST /telegram/auth`, тело `{"phoneNumber":"+10000000000","phoneCode":"abcd"}` | 400, код только из цифр |
| V5 | `POST /telegram/auth`, тело больше 16 КБ | 413, `{"statusCode":413,"message":"request entity too large"}`, контроллер не вызывается |
| V5a | `POST /telegram/auth`, тело больше 16 КБ с `Content-Type: text/plain` | 413: лимит применяется к любому типу содержимого, не только к JSON |
| V5b | `POST /telegram/auth`, тело `{"phoneNumber":"+10000000000","phoneCode":"","password":"  "}` | пустые и пробельные необязательные поля считаются незаполненными, запрос идёт как шаг 1 |
| V6 | `GET /telegram/channel/{channel}/posts?sessionString={session}&hoursBack=0` | 400, допустимый диапазон 1..720 |
| V7 | `GET /telegram/channel/{channel}/posts` без `sessionString` | 400 |

### CORS

| № | Запрос | Ожидаемый результат |
|---|--------|---------------------|
| C1 | `GET /telegram/health` с заголовком `Origin` из `CORS_ALLOWED_ORIGINS` | 200 и заголовок `Access-Control-Allow-Origin` с этим источником |
| C2 | `GET /telegram/health` с посторонним `Origin` | ответ без заголовка `Access-Control-Allow-Origin`, браузер блокирует чтение |
| C3 | `GET /telegram/health` без заголовка `Origin` (серверный вызов) | 200, ограничение не применяется |
| C4 | `CORS_ALLOWED_ORIGINS` пуст или не задан, запрос с любым `Origin` | заголовка нет ни для какого источника |
| C5 | `CORS_ALLOWED_ORIGINS=*` | звёздочка отбрасывается, поведение как в C4 |

### Авторизация и данные

| № | Запрос | Ожидаемый результат |
|---|--------|---------------------|
| A1 | `POST /telegram/auth` с реальным номером | 200, `needsCode: true`, приходит SMS |
| A2 | `POST /telegram/auth` с номером и кодом | 200, `sessionString` либо `needsPassword: true` |
| A3 | `POST /telegram/auth` с номером, кодом и паролем при включённой двухфакторной защите | 200, `sessionString` |
| A4 | `GET /telegram/me?sessionString={session}` | 200, `{"status":"success"}` |
| A5 | `GET /telegram/me` без `sessionString` | 200, `{"status":"failed"}` |
| A6 | `GET /telegram/channel/{channel}/posts?sessionString={session}&hoursBack=24` | 200, список постов за период |

## Устойчивость процесса

| № | Действие | Ожидаемый результат |
|---|----------|---------------------|
| P1 | Фоновое отклонение промиса (например, обрыв сети у GramJS) | запись уровня error в логе, процесс продолжает обслуживать запросы, health по-прежнему 200 |
| P2 | `SIGTERM` процессу | приложение закрывается штатно, в логе `Application closed successfully`, код выхода 0 |
