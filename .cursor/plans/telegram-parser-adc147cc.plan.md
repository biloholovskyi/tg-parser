<!-- adc147cc-df40-4ebc-a161-6df41ef00259 c165332f-260a-4e0f-8fae-f2c0a1dc4898 -->
# Railway Deploy & n8n Integration

## 1. Доработка API endpoint

**Файл: `src/telegram/telegram.service.ts`**

- Добавить параметр `hoursBack` в метод `getLast24HoursPosts` (переименовать в `getChannelPosts`)
- Изменить логику фильтрации постов с фиксированных 24 часов на динамический период
- Формула: `now - (hoursBack * 3600)` для вычисления начальной даты

**Файл: `src/telegram/telegram.controller.ts`**

- Добавить query параметр `hoursBack` (по умолчанию 24) в GET endpoint
- Обновить route: `/telegram/channel/:channelUsername/posts?sessionString=...&hoursBack=48`

**Файл: `src/telegram/dto/messages.dto.ts`**

- Добавить `hoursBack?: number` в DTO с валидацией

**Файл: `src/telegram/interfaces/message.interface.ts`**

- Добавить поле `postUrl` в `TelegramPost` для генерации прямых ссылок на посты (формат: `https://t.me/{channelUsername}/{messageId}`)

## 2. Railway Deployment

**Файл: `railway.toml` (уже создан, проверить)**

- Убедиться что `build.command` и `start.command` корректны
- Добавить `[deploy]` секцию с `restartPolicyType = "always"`

**Railway Dashboard (инструкции для пользователя):**

1. Подключить GitHub репозиторий к Railway
2. Добавить переменные окружения: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `PORT`
3. Railway автоматически выдаст домен типа `your-app.railway.app`
4. После деплоя протестировать health check

## 3. n8n Workflow Setup

**Создать документ: `N8N_WORKFLOW_GUIDE.md`**

Структура workflow:

1. **Telegram Bot Trigger** - реагирует на команду типа `/getposts channel_name hours`
2. **HTTP Request Node** - делает GET запрос к Railway API

- URL: `https://your-app.railway.app/telegram/channel/{{channel}}/posts?sessionString=SESSION&hoursBack={{hours}}`

3. **Function Node** - форматирует посты для передачи в ИИ
4. **OpenAI/Anthropic Node** - генерирует саммари с ссылками
5. **Telegram Node** - отправляет саммари обратно в чат

**Важные детали:**

- Session string хранится в переменной окружения n8n или прямо в workflow
- Парсинг команды от бота: `/getposts durov 48` → channel="durov", hours="48"
- Формат для ИИ: массив `{text, date, postUrl}`

## 4. Финальные штрихи

**Файл: `RAILWAY_DEPLOYMENT.md`**

- Пошаговая инструкция по деплою на Railway
- Как получить URL после деплоя
- Как обновить переменные окружения

**Файл: `N8N_TELEGRAM_BOT.md`**

- Как создать Telegram бота через @BotFather
- Как получить bot token
- Как подключить бота к n8n (Telegram Trigger node)
- Пример команды и ожидаемого ответа

### To-dos

- [ ] Инициализировать NestJS проект и установить зависимости (telegram, @nestjs/*)
- [ ] Создать конфигурацию и .env файл для TELEGRAM_API_ID/API_HASH
- [ ] Создать TelegramModule, TelegramService и TelegramController с базовой структурой
- [ ] Реализовать POST /telegram/auth для получения session string
- [ ] Реализовать GET /telegram/channel/:channelUsername/posts для постов за 24 часа
- [ ] Создать railway.toml и настроить скрипты для деплоя
- [ ] Добавить параметр hoursBack в API и postUrl в интерфейс TelegramPost
- [ ] Проверить railway.toml и создать инструкцию RAILWAY_DEPLOYMENT.md
- [ ] Создать N8N_WORKFLOW_GUIDE.md с примером workflow и N8N_TELEGRAM_BOT.md