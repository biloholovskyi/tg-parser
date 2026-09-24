# Деплой на Railway

Сервис разворачивается на Railway по `railway.toml`: сборщик RAILPACK, запуск `npm run start:prod`, порт 8080, проверка живости `GET /telegram/health`.

## Шаг 1: Создание проекта

Через Dashboard:

1. Открой [railway.app](https://railway.app/) и войди через GitHub
2. Нажми "New Project" → "Deploy from GitHub repo"
3. Выбери репозиторий `tg-parser`

Или через CLI:

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

## Шаг 2: Переменные окружения

В разделе "Variables" добавь (без кавычек):

- `TELEGRAM_API_ID` — числовой API ID с my.telegram.org
- `TELEGRAM_API_HASH` — API hash из 32 символов
- `API_KEYS` — ключи вызывающих сторон через запятую; без них открыт только `/telegram/health`
- `CORS_ALLOWED_ORIGINS` — разрешённые браузерные источники через запятую; пусто — браузерные запросы запрещены, `*` игнорируется

`PORT` задавать не нужно: без него сервис слушает 8080, это совпадает с `internal_port` в `railway.toml`.

Сервис стартует и без `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`: проверка живости отвечает, а ошибка 500 появится при первом обращении к Telegram.

## Шаг 3: Публичный домен

"Settings" → "Networking" → "Generate Domain", или `railway domain` в CLI.

## Шаг 4: Проверка

```bash
curl https://твой-домен.up.railway.app/telegram/health
```

Ответ: `{"status":"ok"}`.

## Шаг 5: Авторизация

Получи `sessionString` через `POST /telegram/auth` в три шага — номер, код, при необходимости пароль 2FA. Каждый запрос несёт заголовок `x-api-key`:

```bash
curl -X POST https://твой-домен.up.railway.app/telegram/auth \
  -H "Content-Type: application/json" \
  -H "x-api-key: твой_ключ" \
  -d '{"phoneNumber": "+номер_телефона"}'
```

Полный порядок шагов и формат ответов — в [README.md](README.md). Дальше строка сессии передаётся только заголовком `x-session-string`.

## Сессии и перезапуски

Кэш клиентов Telegram живёт в памяти процесса. Сейчас код дополнительно пишет строки сессий в `data/`, и после простого перезапуска контейнера сессия может восстановиться из этого файла. Каждый деплой очищает файловую систему Railway, так что после деплоя нужно авторизоваться заново. Рассчитывать на `data/` нельзя: это открытое отклонение от задуманной модели.

Кэш сессий принадлежит одному процессу: при запуске нескольких реплик запрос может попасть в реплику, которая сессию не знает. Держи одну реплику.

## Обновление

Railway пересобирает и разворачивает сервис при каждом push в подключённую ветку. Из CLI — `railway up`.

## Логи

`railway logs` или Dashboard → "Deployments" → деплой → "View Logs". Номера телефонов и строки сессий в логи не пишутся.

## Проблемы

- 401 на любой маршрут, кроме health, — не передан `x-api-key` или ключ не входит в `API_KEYS`
- 500 при авторизации — не заданы `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`, проверь `railway variables`
- `{"status":"failed"}` от `/telegram/me` или 401 от `/telegram/channel/.../posts` — сессия неизвестна после деплоя или отозвана, авторизуйся заново
- Сервис не стартует — смотри логи деплоя
