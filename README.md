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
PORT=3000
```

### 3. Установка зависимостей

```bash
npm install
```

**Важно:** Проект использует `@nestjs/config` для автоматической загрузки .env файла.

### 4. Запуск в режиме разработки

```bash
npm run start:dev
```

Сервер запустится на `http://localhost:3000`

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
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+1234567890"
  }'
```

Ответ:
```json
{
  "needsCode": true,
  "message": "Phone code is required. Please provide the code sent to your phone."
}
```

**Шаг 2: Отправка кода из SMS**

```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
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
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
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

**Сохрани `sessionString` - он нужен для всех остальных запросов!**

### GET /telegram/channel/:channelUsername/posts

Получает посты канала за последние 24 часа.

**Параметры:**
- `channelUsername` - username канала (без @) или его ID
- `sessionString` (query) - строка сессии из `/auth`

**Пример:**

```bash
curl "http://localhost:3000/telegram/channel/durov/posts?sessionString=1AaBbCcDd...твоя_сессия"
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
      ]
    },
    {
      "id": 12344,
      "text": "Еще один пост",
      "date": "2025-11-06T08:15:00.000Z",
      "media": []
    }
  ],
  "count": 2
}
```

**Типы медиа:**
- `photo` - фото
- `video` - видео
- `document` - документ/файл

## 🚂 Деплой на Railway

### Установка Railway CLI

```bash
npm i -g @railway/cli
```

### Авторизация

```bash
railway login
```

### Создание проекта и деплой

```bash
# В корне проекта
railway init
railway up
```

### Настройка environment variables

В Railway Dashboard добавь переменные окружения:
- `TELEGRAM_API_ID` - твой API ID
- `TELEGRAM_API_HASH` - твой API Hash
- `PORT` - Railway автоматически установит

После деплоя Railway предоставит публичный URL для твоего сервиса.

## 🏗️ Архитектура

```
src/
├── main.ts                    # Bootstrap приложения
├── app.module.ts             # Главный модуль
├── telegram/
│   ├── telegram.module.ts    # Модуль Telegram
│   ├── telegram.service.ts   # Бизнес-логика (GramJS)
│   ├── telegram.controller.ts # REST endpoints
│   ├── dto/
│   │   ├── auth.dto.ts      # DTO авторизации
│   │   └── messages.dto.ts  # DTO сообщений
│   └── interfaces/
│       └── message.interface.ts # Типы данных
└── config/
    └── telegram.config.ts    # Конфигурация API
```

## 🔧 Технологии

- **NestJS** - прогрессивный Node.js фреймворк
- **GramJS** - MTProto клиент для Telegram
- **TypeScript** - типизация
- **Railway** - хостинг и деплой

## 📝 Примечания

- Сессия хранится в памяти сервера
- После перезапуска сервера нужно авторизоваться заново
- Для production рекомендуется хранить сессии в базе данных
- Можно парсить как открытые, так и закрытые каналы (если ты в них состоишь)

## 🤝 Масштабирование

В будущем можно добавить:
- Сохранение сессий в Redis/PostgreSQL
- Скачивание медиа-файлов
- Поиск по сообщениям
- Экспорт данных в различных форматах
- Webhook-и для новых сообщений
- Rate limiting
- Аутентификация через API ключи

## 📄 Лицензия

MIT

