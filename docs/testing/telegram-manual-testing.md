# Ручное тестирование — модуль telegram

Артефакт к блокам 01 и 02. Покрывает REST-поверхность после подключения глобальной валидации, ограничения размера тела, списка разрешённых источников CORS, аутентификации вызывающей стороны, рейт-лимитов и переноса строки сессии в заголовок.

Парный файл для Postman: [telegram-postman-collection.json](telegram-postman-collection.json).

## Предусловия

- Сервис собран и запущен: `rtk npm run build`, затем `rtk npm run start:prod`.
- Переменные окружения: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `PORT` (по умолчанию 8080), `CORS_ALLOWED_ORIGINS` (список источников через запятую; пустое значение запрещает все браузерные источники), `API_KEYS` (ключи вызывающих сторон через запятую; пустое значение закрывает всё, кроме health).
- Базовый адрес в примерах: `http://127.0.0.1:8080`.

## Модель авторизации

- Каждый маршрут, кроме health, требует заголовок `x-api-key` со значением из `API_KEYS`. Отсутствующий, чужой или повторённый ключ даёт 401 с одинаковым сообщением.
- `sessionString` — полномочия на весь аккаунт Telegram. Хранить только в переменной Postman, никогда не коммитить и не писать в отчёты.
- Получение: `POST /telegram/auth` в два или три шага — телефон, затем код из SMS, при включённой двухфакторной защите ещё и пароль. Ответ последнего шага содержит `sessionString`.
- Передача: `sessionString` идёт заголовком `x-session-string` у `GET /telegram/me` и у постов канала. В query-параметре строка сессии не принимается: у постов такой запрос отклоняется с 400, а `GET /telegram/me` отвечает 200 `{"status":"failed"}`, потому что этот маршрут по контракту всегда 200.
- Рейт-лимиты: 60 запросов в минуту на ключ на всех маршрутах, кроме health, и 5 запросов в час на номер телефона для `POST /telegram/auth`. Превышение — 429 с заголовком `Retry-After` и полем `retryAfterSeconds`.

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
| V5 | `POST /telegram/auth`, тело больше 16 КБ | 413, `{"message":"Payload Too Large","statusCode":413}`, контроллер не вызывается |
| V5a | `POST /telegram/auth`, тело больше 16 КБ с `Content-Type: text/plain` | 413: лимит применяется к любому типу содержимого, не только к JSON |
| V5b | `POST /telegram/auth`, тело `{"phoneNumber":"+10000000000","phoneCode":"","password":"  "}` | пустые и пробельные необязательные поля считаются незаполненными, запрос идёт как шаг 1 |
| V6 | `GET /telegram/channel/{channel}/posts?hoursBack=0` с заголовком сессии | 400, допустимый диапазон 1..720 |
| V7 | `GET /telegram/channel/{channel}/posts` без заголовка `x-session-string` | 400 |
| V8 | `GET /telegram/channel/!!/posts` с обоими заголовками | 400, имя канала не проходит проверку формата, обращения к Telegram нет |
| V9 | `POST /telegram/auth`, тело `{"phoneNumber":"+10000000000","password":"x"}` | 400, пароль принимается только вместе с кодом |

### Периметр доступа

| № | Запрос | Ожидаемый результат |
|---|--------|---------------------|
| P1 | `GET /telegram/me` без заголовка `x-api-key` | 401, сервис Telegram не вызывается |
| P2 | `GET /telegram/me` с ключом, которого нет в `API_KEYS` | 401 с тем же сообщением, что и в P1 |
| P3 | `GET /telegram/health` без ключа | 200, health остаётся публичным |
| P4 | `GET /telegram/channel/{channel}/posts?sessionString={session}` | 400, строка сессии в query не обслуживается |
| P5 | `POST /telegram/auth` шесть раз подряд с одним номером | шестой запрос 429, заголовок `Retry-After` и поле `retryAfterSeconds`; другой номер в это же время обслуживается |
| P6 | 61 запрос за минуту с одним ключом на любой маршрут кроме health | последний 429; запрос с другим ключом проходит |
| P7 | `API_KEYS` не задана, любой запрос кроме health | 401: отсутствие настроенных ключей означает отказ, а не открытый режим |

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
| A4 | `GET /telegram/me` с заголовком `x-session-string` | 200, `{"status":"success"}` |
| A5 | `GET /telegram/me` без заголовка сессии | 200, `{"status":"failed"}` |
| A6 | `GET /telegram/channel/{channel}/posts?hoursBack=24` с заголовком сессии | 200, список постов за период, `isTruncated: false` |
| A7 | `GET /telegram/channel/{busy-channel}/posts?hoursBack=720` для канала, где за окно больше 1000 сообщений | 200, ровно столько постов, сколько вошло в потолок POSTS_MAX_MESSAGES, `isTruncated: true` |
| A8 | То же, что A7, для канала, где за окно меньше 1000 сообщений | 200, все посты окна, `isTruncated: false` |

### Ошибки Telegram

| № | Запрос | Ожидаемый результат |
|---|--------|---------------------|
| E1 | `GET /telegram/me` с выдуманной строкой сессии | 200, `{"status":"failed"}` |
| E2 | `GET /telegram/me` с сессией, завершённой в настройках Telegram («Завершить сеанс») | 200, `{"status":"failed"}`; повторный запрос тоже `failed`, клиент вытеснен |
| E3 | `GET /telegram/me` при недоступном Telegram (сеть отключена) | 503, `Telegram is unreachable, retry later` |
| E4 | `GET /telegram/channel/{channel}/posts` с выдуманной строкой сессии | 401, `Session is invalid or revoked, authenticate again` (то же сообщение, что для отозванной сессии) |
| E5 | `GET /telegram/channel/{channel}/posts` с отозванной сессией | 401, `Session is invalid or revoked, authenticate again` |
| E6 | `GET /telegram/channel/{nonexistent}/posts` | 404, `Channel not found or not accessible to this account` |
| E7 | `GET /telegram/channel/{private-channel}/posts`, аккаунт не участник | 404, то же сообщение |
| E8 | `POST /telegram/auth` с неверным кодом | 400, `The phone code is invalid` |
| E9 | `POST /telegram/auth` с кодом после истечения срока | 400, `The phone code has expired, request a new one` |
| E10 | `POST /telegram/auth` с неверным паролем 2FA | 400, `The 2FA password is wrong` |
| E11 | `POST /telegram/auth` с кодом без предварительного шага 1 | 400, `Request a code first by sending phoneNumber without a code` |
| E12 | Флуд-вейт от Telegram дольше FLOOD_SLEEP_THRESHOLD_S (частые шаги 1 с одним номером) | 429, поле `retryAfterSeconds` равно ожиданию, запрошенному Telegram; ответ приходит сразу, без ожидания |
| E13 | Любой запрос, кроме health, без `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | 500, `Telegram API credentials are not configured` |
| E14 | Любая ошибка из E1–E13 | в теле ответа нет текста MTProto-ошибки и стека |

## Устойчивость процесса

| № | Действие | Ожидаемый результат |
|---|----------|---------------------|
| R1 | Фоновое отклонение промиса (например, обрыв сети у GramJS) | запись уровня error в логе, процесс продолжает обслуживать запросы, health по-прежнему 200 |
| R2 | `SIGTERM` процессу | приложение закрывается штатно, в логе `Application closed successfully`, код выхода 0 |
