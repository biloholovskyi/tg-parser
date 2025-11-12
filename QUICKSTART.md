# ⚡ Быстрый старт

## 1. Получи Telegram API credentials (5 минут)

1. Открой https://my.telegram.org
2. Войди по номеру телефона
3. Перейди в **"API development tools"**
4. Заполни форму:
   - App title: `My Parser`
   - Short name: `parser`
   - Platform: `Other`
5. Сохрани `api_id` и `api_hash`

## 2. Настройка проекта (2 минуты)

```bash
# Установи зависимости
npm install

# Создай .env файл
cp .env.example .env
```

Открой `.env` и заполни:
```
TELEGRAM_API_ID=твой_api_id
TELEGRAM_API_HASH=твой_api_hash
PORT=3000
```

## 3. Запусти сервер (1 минута)

```bash
npm run start:dev
```

Сервер запустится на http://localhost:3000

## 4. Авторизуйся в Telegram (2 минуты)

### Шаг 1: Отправь номер

```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+79991234567"}'
```

### Шаг 2: Введи код из SMS

```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+79991234567", "phoneCode": "12345"}'
```

Получишь `sessionString` - сохрани его!

## 5. Получи посты (1 минута)

```bash
curl "http://localhost:3000/telegram/channel/durov/posts?sessionString=ТВОЯ_СЕССИЯ"
```

## ✅ Готово!

Теперь у тебя работающий парсер Telegram каналов.

---

## Что дальше?

- 📖 [Полная документация](README.md)
- 🚀 [Деплой на Railway](DEPLOYMENT.md)  
- 💡 [Примеры использования](USAGE.md)

## Проблемы?

- Session expired → авторизуйся заново
- Channel not found → проверь username
- Invalid credentials → проверь API_ID и API_HASH в .env

