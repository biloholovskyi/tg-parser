# n8n Workflow Guide - Telegram Channel Parser

Этот гайд объясняет, как настроить n8n workflow для получения постов из Telegram каналов через бота и генерации саммари с помощью ИИ.

## Архитектура Workflow

```
[Telegram Bot Trigger] 
    ↓
[Parse Command] 
    ↓
[HTTP Request to Railway API]
    ↓
[Format Posts for AI]
    ↓
[OpenAI / Claude / Local AI]
    ↓
[Send Summary to Telegram]
```

## Предварительные требования

1. Railway API задеплоено и работает
2. Session string получен (см. [RAILWAY_DEPLOYMENT.md](./RAILWAY_DEPLOYMENT.md))
3. Telegram бот создан (см. [N8N_TELEGRAM_BOT.md](./N8N_TELEGRAM_BOT.md))
4. n8n установлен (локально или в облаке)
5. API ключ от OpenAI/Anthropic (или локальный LLM)

## Шаг 1: Настройка Credentials в n8n

### Telegram Credentials

1. В n8n перейди в **Credentials** → **New**
2. Выбери **Telegram API**
3. Введи Bot Token из @BotFather
4. Сохрани как "Telegram Bot"

### OpenAI Credentials (или другой ИИ)

1. **Credentials** → **New** → **OpenAI API**
2. Введи API Key
3. Сохрани как "OpenAI"

## Шаг 2: Создание Workflow

### Node 1: Telegram Trigger

1. Добавь node **Telegram Trigger**
2. Выбери Credential "Telegram Bot"
3. Updates: `message`
4. Включи "Download attachments": `No` (не нужно)

### Node 2: Function - Parse Command

Парсит команду от пользователя типа `/getposts durov 48`.

```javascript
// Получаем текст сообщения
const messageText = $input.item.json.message.text;
const chatId = $input.item.json.message.chat.id;

// Парсим команду
const parts = messageText.trim().split(' ');
const command = parts[0];

// Проверяем команду
if (command !== '/getposts') {
  return [{
    json: {
      chatId: chatId,
      reply: "Используй команду: /getposts <channel> <hours>\n\nПример: /getposts durov 24"
    }
  }];
}

// Извлекаем параметры
const channel = parts[1];
const hours = parts[2] ? parseInt(parts[2]) : 24;

// Валидация
if (!channel) {
  return [{
    json: {
      chatId: chatId,
      reply: "Укажи название канала!\n\nПример: /getposts durov 24"
    }
  }];
}

if (hours < 1 || hours > 720) {
  return [{
    json: {
      chatId: chatId,
      reply: "Количество часов должно быть от 1 до 720 (30 дней)"
    }
  }];
}

// Возвращаем распарсенные данные
return [{
  json: {
    chatId: chatId,
    channel: channel,
    hours: hours
  }
}];
```

### Node 3: HTTP Request - Get Posts from Railway

Получает посты из API.

**Settings:**
- Method: `GET`
- URL: `https://твой-домен.railway.app/telegram/channel/{{ $json.channel }}/posts`
- Query Parameters:
  - `sessionString`: `твой_session_string` (из шага авторизации)
  - `hoursBack`: `{{ $json.hours }}`
- Authentication: `None`

**⚠️ ВАЖНО:** Замени:
- `твой-домен.railway.app` на реальный домен Railway
- `твой_session_string` на реальный session string

### Node 4: IF - Check Response

Проверяем, что запрос успешен.

**Conditions:**
- Condition: `$json.count` > 0

**True branch:** Продолжаем обработку  
**False branch:** Отправляем сообщение "Постов не найдено"

### Node 5: Function - Format Posts for AI

Форматируем посты для передачи в ИИ.

```javascript
const posts = $input.item.json.posts;
const channel = $('Parse Command').item.json.channel;

// Форматируем посты в удобочитаемый текст
let formattedPosts = `Посты из канала @${channel} за последние часы:\n\n`;

posts.forEach((post, index) => {
  formattedPosts += `--- Пост ${index + 1} ---\n`;
  formattedPosts += `Дата: ${new Date(post.date).toLocaleString('ru-RU')}\n`;
  formattedPosts += `Текст: ${post.text || '(без текста)'}\n`;
  formattedPosts += `Медиа: ${post.media.length > 0 ? post.media.map(m => m.type).join(', ') : 'нет'}\n`;
  formattedPosts += `Ссылка: ${post.postUrl}\n\n`;
});

// Промпт для ИИ
const prompt = `Проанализируй посты из Telegram канала и создай краткое саммари на русском языке.

${formattedPosts}

Задача:
1. Создай краткое саммари основных тем и новостей
2. Выдели ключевые моменты
3. Добавь ссылки на важные посты в формате [Пост 1](ссылка)
4. Форматируй в markdown
5. Максимум 500 слов

Саммари:`;

return [{
  json: {
    prompt: prompt,
    chatId: $('Parse Command').item.json.chatId,
    postsCount: posts.length,
    channelUsername: channel
  }
}];
```

### Node 6: OpenAI - Generate Summary

Генерирует саммари с помощью ИИ.

**Settings:**
- Resource: `Text`
- Operation: `Message a Model`
- Model: `gpt-4` (или `gpt-3.5-turbo` для экономии)
- Prompt: `{{ $json.prompt }}`
- Temperature: `0.7`
- Max Tokens: `1000`

**Альтернативы:**
- **Claude (Anthropic):** используй node "Anthropic" с моделью Claude
- **Локальный LLM:** используй node "HTTP Request" к локальному Ollama/LM Studio

### Node 7: Function - Format Final Message

Форматирует итоговое сообщение для Telegram.

```javascript
const summary = $input.item.json.message.content;
const postsCount = $('Format Posts for AI').item.json.postsCount;
const channel = $('Format Posts for AI').item.json.channelUsername;

const finalMessage = `📊 Саммари постов из @${channel}\n\n${summary}\n\n---\n📈 Обработано постов: ${postsCount}`;

return [{
  json: {
    chatId: $('Format Posts for AI').item.json.chatId,
    text: finalMessage,
    parse_mode: 'Markdown'
  }
}];
```

### Node 8: Telegram - Send Message

Отправляет саммари обратно пользователю.

**Settings:**
- Resource: `Message`
- Operation: `Send Message`
- Chat ID: `{{ $json.chatId }}`
- Text: `{{ $json.text }}`
- Additional Fields → Reply Markup: `None`
- Additional Fields → Parse Mode: `Markdown`

### Node 9 (False branch): Telegram - No Posts Found

Отправляет сообщение, если постов не найдено.

**Settings:**
- Chat ID: `{{ $('Parse Command').item.json.chatId }}`
- Text: `Постов не найдено в канале @{{ $('Parse Command').item.json.channel }} за последние {{ $('Parse Command').item.json.hours }} часов.`

## Шаг 3: Тестирование

1. Активируй workflow в n8n (переключатель вверху)
2. Открой своего бота в Telegram
3. Отправь команду:

```
/getposts durov 24
```

4. Бот должен ответить саммари постов через несколько секунд

## Оптимизация и улучшения

### Кеширование результатов

Добавь node для сохранения результатов в базу данных, чтобы не делать повторные запросы.

### Обработка ошибок

Добавь node "Error Trigger" для обработки ошибок и отправки уведомлений.

### Фильтрация по ключевым словам

Перед отправкой в ИИ, отфильтруй посты по ключевым словам:

```javascript
const keywords = ['биткоин', 'криптовалюта', 'блокчейн'];
const filteredPosts = posts.filter(post => 
  keywords.some(kw => post.text.toLowerCase().includes(kw))
);
```

### Автоматический мониторинг

Вместо Telegram Trigger используй **Schedule Trigger** для автоматической проверки каналов каждый час.

## Пример готового workflow (JSON)

<details>
<summary>Нажми чтобы увидеть JSON workflow</summary>

```json
{
  "name": "Telegram Channel Parser",
  "nodes": [
    {
      "name": "Telegram Trigger",
      "type": "n8n-nodes-base.telegramTrigger",
      "position": [250, 300],
      "parameters": {
        "updates": ["message"]
      },
      "credentials": {
        "telegramApi": "Telegram Bot"
      }
    }
  ],
  "connections": {}
}
```

*Полный JSON слишком большой для этого файла. Создай workflow вручную по инструкции выше или экспортируй свой workflow после создания.*
</details>

## Проблемы и решения

### Session expired

Если получаешь ошибку "Session not found" - нужно заново авторизоваться на Railway и обновить session string в n8n.

### Timeout ошибки

Если канал большой, увеличь timeout в HTTP Request node (Settings → Timeout → 30000ms).

### ИИ возвращает на английском

Усиль промпт: добавь "ВАЖНО: Отвечай ТОЛЬКО на русском языке" в начало промпта.

### Слишком дорого (OpenAI)

Используй:
1. `gpt-3.5-turbo` вместо `gpt-4`
2. Локальный LLM (Ollama + Llama 3)
3. Уменьши количество постов перед отправкой в ИИ

## Следующие шаги

- Добавь базу данных для хранения истории запросов
- Настрой мониторинг нескольких каналов
- Добавь автоматическую отправку дайджестов в личку или группу
- Интегрируй с Google Sheets для сохранения постов




