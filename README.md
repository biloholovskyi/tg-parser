# Telegram Parser Service

Сервис для парсинга открытых и закрытых Telegram каналов через личный аккаунт, построенный на NestJS и GramJS.

## 🚀 Быстрый старт

### 1. Получение Telegram API credentials

1. Открой https://my.telegram.org
2. Войди под своим номером телефона
3. Перейди в "API development tools"
4. Создай новое приложение:
   - **App title**: любое название (например "My Parser")
   - **Short name**: короткое имя (например "parser")
   - **Platform**: выбери "Other"
5. Получишь `api_id` (число) и `api_hash` (строка из 32 символов)

### 2. Настройка проекта

Создай `.env` файл в корне проекта:

```env
TELEGRAM_API_ID=твой_api_id
TELEGRAM_API_HASH=твой_api_hash
PORT=8080
CORS_ALLOWED_ORIGINS=http://localhost:5173
API_KEYS=первый_ключ,второй_ключ
```

`PORT` необязателен: без него сервис слушает порт 8080. `CORS_ALLOWED_ORIGINS` — список разрешённых браузерных источников через запятую; пустое значение запрещает все браузерные источники, `*` игнорируется. `API_KEYS` — ключи вызывающих сторон через запятую; пустое или незаданное значение закрывает все маршруты, кроме health-проверки.

### 3. Установка зависимостей

```bash
npm install
```

**Важно:** Проект использует `@nestjs/config` для автоматической загрузки .env файла.

### 4. Запуск в режиме разработки

```bash
npm run start:dev
```

Сервер запустится на `http://localhost:8080`

### 5. Сборка для продакшна

```bash
npm run build
npm run start:prod
```

## 📡 API Endpoints

### POST /telegram/auth

Авторизация через Telegram. Процесс многоэтапный:

**Шаг 1: Отправка номера телефона**

```bash
curl -X POST http://localhost:8080/telegram/auth \
  -H "Content-Type: application/json" \
  -H "x-api-key: твой_ключ" \
  -d '{
    "phoneNumber": "+1234567890"
  }'
```

Ответ:
```json
{
  "needsCode": true,
  "message": "Phone code has been sent to your phone. Please provide the code."
}
```

**Шаг 2: Отправка кода из SMS**

```bash
curl -X POST http://localhost:8080/telegram/auth \
  -H "Content-Type: application/json" \
  -H "x-api-key: твой_ключ" \
  -d '{
    "phoneNumber": "+1234567890",
    "phoneCode": "12345"
  }'
```

Если у тебя включена двухфакторная аутентификация:
```json
{
  "needsPassword": true,
  "message": "2FA password is required."
}
```

**Шаг 3 (опционально): Отправка 2FA пароля**

```bash
curl -X POST http://localhost:8080/telegram/auth \
  -H "Content-Type: application/json" \
  -H "x-api-key: твой_ключ" \
  -d '{
    "phoneNumber": "+1234567890",
    "phoneCode": "12345",
    "password": "your_2fa_password"
  }'
```

Успешный ответ:
```json
{
  "sessionString": "1AaBbCcDd...длинная_строка",
  "message": "Successfully authenticated"
}
```

**Сохрани `sessionString` - он нужен для всех остальных запросов!** Передавай его только заголовком `x-session-string`: это полномочия на весь аккаунт, а URL попадает в логи прокси и платформы.

### Доступ к API

Каждый маршрут, кроме `GET /telegram/health`, требует заголовок `x-api-key` со значением из `API_KEYS`. Без него или с чужим ключом ответ — 401.

Действуют ограничения частоты: 60 запросов в минуту на ключ и 5 запросов в час на один номер телефона для `POST /telegram/auth`. При превышении приходит 429 с заголовком `Retry-After`.

### GET /telegram/health

Проверка живости. Единственный маршрут без ключа, отвечает `{"status":"ok"}` и ничего не знает о Telegram.

### GET /telegram/me

Проверяет, жива ли сессия. Строка сессии передаётся заголовком `x-session-string`.

```bash
curl http://localhost:8080/telegram/me \
  -H "x-api-key: твой_ключ" \
  -H "x-session-string: 1AaBbCcDd...твоя_сессия"
```

Ответ 200: `{"status":"success"}` или `{"status":"failed"}`, где `failed` означает неизвестную или отозванную сессию. Если Telegram недоступен, ответ 503, при ограничении частоты со стороны Telegram — 429: это не приговор сессии, запрос стоит повторить позже.

### GET /telegram/channel/:channelUsername/posts

Получает посты канала за последние `hoursBack` часов (по умолчанию 24). За один запрос просматривается не больше 1000 сообщений; если в окне их больше, ответ содержит `"isTruncated": true`.

**Параметры:**
- `channelUsername` (путь) - username канала, с `@` или без
- `x-session-string` (заголовок) - строка сессии из `/auth`; в query-параметре она не принимается
- `hoursBack` (query, необязательный) - глубина выборки в часах, от 1 до 720, по умолчанию 24

**Пример:**

```bash
curl "http://localhost:8080/telegram/channel/durov/posts?hoursBack=24" \
  -H "x-api-key: твой_ключ" \
  -H "x-session-string: 1AaBbCcDd...твоя_сессия"
```

Ответ:
```json
{
  "posts": [
    {
      "id": 12345,
      "text": "Текст поста",
      "date": "2025-11-06T10:30:00.000Z",
      "media": [
        {
          "type": "photo"
        }
      ],
      "postUrl": "https://t.me/durov/12345"
    },
    {
      "id": 12344,
      "text": "Еще один пост",
      "date": "2025-11-06T08:15:00.000Z",
      "media": [],
      "postUrl": "https://t.me/durov/12344"
    }
  ],
  "count": 2,
  "isTruncated": false
}
```

**Коды ошибок:**
- `400` — не передана строка сессии или неверные параметры запроса
- `401` — сессия неизвестна или отозвана, нужно авторизоваться заново
- `404` — канал не найден или недоступен этому аккаунту
- `429` — Telegram просит подождать, срок в поле `retryAfterSeconds`
- `502` — прочий отказ Telegram
- `503` — Telegram недоступен

У `POST /telegram/auth` свои ошибки: `400` — неверный код или пароль 2FA (у каждого случая своё сообщение), `500` — не заданы `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`.

**Типы медиа:**
- `photo` - фото
- `video` - видео
- `document` - документ/файл

## 🚂 Деплой на Railway

Пошаговая инструкция — в [DEPLOYMENT.md](DEPLOYMENT.md).

## 🛠️ Команды

```bash
npm run start:dev   # разработка с перезапуском
npm run build       # сборка в dist/
npm run start:prod  # запуск собранного сервиса
npm run lint        # ESLint с автоисправлением
npm run typecheck   # проверка типов
npm test            # unit-тесты
npm run test:e2e    # E2E-тесты
```

## 🏗️ Архитектура

```
src/
├── main.ts                    # Bootstrap приложения
├── app.module.ts             # Главный модуль
├── telegram/
│   ├── telegram.module.ts    # Модуль Telegram
│   ├── telegram.service.ts   # Фасад для контроллера, проверка сессии, порядок остановки
│   ├── auth.service.ts       # Многошаговая авторизация
│   ├── channel.service.ts    # Постраничный обход канала
│   ├── session-store.ts      # Жизненный цикл клиентов и кэш сессий
│   ├── telegram-client.factory.ts # Единственное место создания TelegramClient
│   ├── telegram.controller.ts # REST endpoints
│   ├── constants.ts          # Лимиты кэша, таймауты, коды ошибок MTProto
│   ├── utils/                # Кэш клиентов, таймауты, сопоставление ошибок, маппер сообщений
│   ├── dto/
│   │   ├── auth.dto.ts      # DTO авторизации
│   │   └── messages.dto.ts  # DTO запроса постов
│   └── interfaces/
│       └── message.interface.ts # Типы данных
├── shared/
│   ├── constants/            # Заголовки, лимиты, размер тела
│   ├── decorators/           # Публичный маршрут, лимит по номеру, строка сессии
│   ├── exceptions/           # 429 с Retry-After
│   ├── guards/               # Ключ вызывающей стороны и рейт-лимиты
│   └── utils/                # HTTP-конвейер, счётчики, чтение заголовков
└── config/
    ├── api-keys.config.ts    # Ключи вызывающих сторон
    ├── cors.config.ts        # Список источников CORS
    └── telegram.config.ts    # Конфигурация API
```

## 🔧 Технологии

- **NestJS** - прогрессивный Node.js фреймворк
- **GramJS** - MTProto клиент для Telegram
- **TypeScript** - типизация
- **Railway** - хостинг и деплой

## 📝 Примечания

- Клиенты Telegram кэшируются в памяти процесса: не больше 50 сессий, неактивные вытесняются
- Сессии и незавершённые входы хранятся только в памяти, на диск ничего не пишется: после перезапуска или деплоя нужно авторизоваться заново
- Кэш принадлежит одному процессу, поэтому сервис запускается в одном экземпляре
- Можно парсить как открытые, так и закрытые каналы (если ты в них состоишь)

## 📚 Документация

- [DEPLOYMENT.md](DEPLOYMENT.md) — деплой на Railway
- [CHANGELOG.md](CHANGELOG.md) — история версий
- [docs/integrations/n8n-workflow-guide.md](docs/integrations/n8n-workflow-guide.md) — n8n workflow: посты канала и саммари через ИИ
- [docs/integrations/n8n-telegram-bot.md](docs/integrations/n8n-telegram-bot.md) — Telegram-бот для n8n
- [examples/test-api.http](examples/test-api.http) — запросы для VS Code REST Client

## 🤝 Масштабирование

В будущем можно добавить:
- Сохранение сессий в Redis/PostgreSQL
- Скачивание медиа-файлов
- Поиск по сообщениям
- Экспорт данных в различных форматах
- Webhook-и для новых сообщений

## 📄 Лицензия

MIT

