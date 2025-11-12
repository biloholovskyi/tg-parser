# ⚠️ КАК ПРАВИЛЬНО ИСПОЛЬЗОВАТЬ API

## Проблема: Зацикливание при переходе в браузере

Если ты переходишь на `http://localhost:3002/telegram/auth` **через браузер**, это делает **GET запрос**.

Но `/telegram/auth` - это **POST endpoint** для авторизации!

---

## ✅ Правильное использование

### 1. Используй POST запрос (не браузер!)

#### С curl:
```bash
curl -X POST http://localhost:3002/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+79991234567"}'
```

#### С Postman/Insomnia:
- Method: **POST**
- URL: `http://localhost:3002/telegram/auth`
- Headers: `Content-Type: application/json`
- Body (JSON):
```json
{
  "phoneNumber": "+79991234567"
}
```

#### С VS Code REST Client:
Открой `examples/test-api.http` и нажми "Send Request"

---

## 📖 Что делает каждый endpoint

### GET /telegram/auth
**Только информация** - не выполняет авторизацию!

Открой в браузере: `http://localhost:3002/telegram/auth`

Увидишь инструкцию как использовать POST запрос.

### POST /telegram/auth
**Реальная авторизация** - отправка кода, проверка и т.д.

**НЕ ОТКРЫВАЕТСЯ В БРАУЗЕРЕ!** Используй curl/Postman.

---

## 🎯 Пошаговая авторизация

### Шаг 1: Запроси код
```bash
curl -X POST http://localhost:3002/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+79991234567"}'
```

Ответ:
```json
{
  "needsCode": true,
  "message": "Phone code has been sent to your phone..."
}
```

Telegram отправит код на телефон ✅

### Шаг 2: Отправь код из SMS
```bash
curl -X POST http://localhost:3002/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+79991234567",
    "phoneCode": "12345"
  }'
```

**Если 2FA выключена:**
```json
{
  "sessionString": "1AaBbCc...длинная_строка",
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

### Шаг 3: (Если нужен 2FA) Отправь пароль
```bash
curl -X POST http://localhost:3002/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+79991234567",
    "phoneCode": "12345",
    "password": "your_2fa_password"
  }'
```

Ответ:
```json
{
  "sessionString": "1AaBbCc...длинная_строка",
  "message": "Successfully authenticated"
}
```

**Сохрани sessionString!**

---

## 🚀 Получение постов

После авторизации используй sessionString:

```bash
curl "http://localhost:3002/telegram/channel/durov/posts?sessionString=твоя_сессия"
```

---

## 💡 Простые способы тестирования

### 1. VS Code REST Client (рекомендуется)
1. Установи расширение "REST Client"
2. Открой `examples/test-api.http`
3. Нажми "Send Request" над нужным запросом

### 2. Интерактивный клиент
```bash
node examples/client.js
```

Проведет через все шаги интерактивно!

### 3. Postman/Insomnia
Импортируй запросы из `examples/test-api.http`

---

## ❌ Не делай так:

1. ❌ Не открывай POST endpoints в браузере
2. ❌ Не используй GET для авторизации
3. ❌ Не забывай Content-Type: application/json
4. ❌ Не используй одинаковый порт (у тебя 3002, не 3000)

---

## ✅ Делай так:

1. ✅ Используй curl/Postman для POST запросов
2. ✅ Отправляй JSON в body
3. ✅ Проверяй порт (у тебя 3002)
4. ✅ Сохраняй sessionString из ответа

---

## 🧪 Быстрый тест

```bash
# 1. Проверь что сервер работает (GET - можно в браузере)
curl http://localhost:3002/telegram/auth

# 2. Запроси код (POST - только через curl/Postman!)
curl -X POST http://localhost:3002/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+твой_номер"}'

# 3. Проверь телефон - пришел код?
# 4. Отправь код
curl -X POST http://localhost:3002/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+твой_номер", "phoneCode": "12345"}'

# 5. Скопируй sessionString из ответа

# 6. Получи посты
curl "http://localhost:3002/telegram/channel/durov/posts?sessionString=твоя_сессия"
```

---

## 🆘 Все еще проблемы?

Покажи:
1. Точную команду которую используешь
2. Полный ответ от сервера
3. Логи из консоли где запущен сервер

