# Руководство по использованию

## Локальный запуск

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка .env

Скопируй `.env.example` в `.env`:

```bash
cp .env.example .env
```

Заполни:
```
TELEGRAM_API_ID=твой_api_id
TELEGRAM_API_HASH=твой_api_hash
PORT=3000
```

### 3. Запуск

Режим разработки (с hot-reload):
```bash
npm run start:dev
```

Продакшн режим:
```bash
npm run build
npm run start:prod
```

## Использование API

### Авторизация (получение session string)

Процесс авторизации многоэтапный:

#### Шаг 1: Отправка номера телефона

```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+79991234567"
  }'
```

Telegram отправит код на твой телефон. Ответ:
```json
{
  "needsCode": true,
  "message": "Phone code is required. Please provide the code sent to your phone."
}
```

#### Шаг 2: Отправка кода

```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+79991234567",
    "phoneCode": "12345"
  }'
```

**Если 2FA выключена:**
```json
{
  "sessionString": "1BVtsOKsBu7N...[длинная строка]",
  "message": "Successfully authenticated"
}
```

**Если 2FA включена:**
```json
{
  "needsPassword": true,
  "message": "2FA password is required."
}
```

#### Шаг 3 (если нужен пароль): Отправка 2FA пароля

```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+79991234567",
    "phoneCode": "12345",
    "password": "your_cloud_password"
  }'
```

Успешный ответ:
```json
{
  "sessionString": "1BVtsOKsBu7N...[длинная строка]",
  "message": "Successfully authenticated"
}
```

**ВАЖНО:** Сохрани `sessionString`! Он нужен для всех последующих запросов.

### Получение постов канала

После авторизации используй sessionString для получения постов:

```bash
curl "http://localhost:3000/telegram/channel/durov/posts?sessionString=1BVtsOKsBu7N..."
```

Параметры:
- `durov` - замени на username канала (без @)
- `sessionString` - твоя сессия из шага авторизации

Ответ:
```json
{
  "posts": [
    {
      "id": 123456,
      "text": "Hello world! This is a test post.",
      "date": "2025-11-06T15:30:00.000Z",
      "media": []
    },
    {
      "id": 123455,
      "text": "Check out this photo!",
      "date": "2025-11-06T14:20:00.000Z",
      "media": [
        {
          "type": "photo"
        }
      ]
    },
    {
      "id": 123454,
      "text": "Video tutorial",
      "date": "2025-11-06T12:15:00.000Z",
      "media": [
        {
          "type": "video"
        }
      ]
    }
  ],
  "count": 3
}
```

## Примеры использования

### JavaScript (fetch)

```javascript
// Авторизация
async function authenticate(phoneNumber, phoneCode, password) {
  const response = await fetch('http://localhost:3000/telegram/auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phoneNumber,
      phoneCode,
      password,
    }),
  });
  
  return await response.json();
}

// Получение постов
async function getPosts(channelUsername, sessionString) {
  const response = await fetch(
    `http://localhost:3000/telegram/channel/${channelUsername}/posts?sessionString=${sessionString}`
  );
  
  return await response.json();
}

// Использование
const auth = await authenticate('+79991234567', '12345');
console.log(auth.sessionString);

const posts = await getPosts('durov', auth.sessionString);
console.log(posts);
```

### Python (requests)

```python
import requests

# Авторизация
def authenticate(phone_number, phone_code=None, password=None):
    url = "http://localhost:3000/telegram/auth"
    data = {
        "phoneNumber": phone_number,
        "phoneCode": phone_code,
        "password": password
    }
    response = requests.post(url, json=data)
    return response.json()

# Получение постов
def get_posts(channel_username, session_string):
    url = f"http://localhost:3000/telegram/channel/{channel_username}/posts"
    params = {"sessionString": session_string}
    response = requests.get(url, params=params)
    return response.json()

# Использование
auth = authenticate("+79991234567", "12345")
session = auth["sessionString"]

posts = get_posts("durov", session)
print(posts)
```

## Типичные ошибки

### "TELEGRAM_API_ID is not configured"

Не настроены переменные окружения. Создай `.env` файл.

### "Invalid session string or session expired"

Session string истек или неверный. Повтори авторизацию.

### "Invalid channel username"

Проверь:
- Username указан без @
- Канал существует
- Ты имеешь доступ к каналу (для закрытых)

### "Channel is private and you are not a member"

Нужно вступить в канал через свой Telegram аккаунт.

## Ограничения

- Посты получаются только за последние 24 часа
- Максимум 100 постов за запрос
- Session хранится в памяти (при перезапуске сервера нужно авторизоваться заново)
- Медиа-файлы не скачиваются (только определяется тип)

## Следующие шаги

Для продакшн использования рекомендуется:

1. **Хранение сессий в БД** - добавь Redis или PostgreSQL
2. **Скачивание медиа** - реализуй загрузку фото/видео
3. **Защита API** - добавь API ключи или JWT
4. **Rate limiting** - ограничь количество запросов
5. **Логирование** - добавь Winston или Pino
6. **Валидация** - используй class-validator для DTO

