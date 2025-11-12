# 📋 Что нужно сделать ТЕБЕ

Проект настроен и готов к работе. Осталось выполнить несколько простых шагов:

## ✅ Обязательные шаги

### 1. Установить зависимости

```bash
npm install
```

Это установит все необходимые библиотеки из `package.json`.

### 2. Получить Telegram API credentials

**Важно!** Без этого сервис не запустится.

1. Открой https://my.telegram.org
2. Войди по номеру телефона
3. Перейди в **"API development tools"**
4. Заполни форму:
   - App title: `My Parser` (или любое другое)
   - Short name: `parser`
   - Platform: `Other`
5. Скопируй `api_id` и `api_hash`

### 3. Создать .env файл

```bash
# В корне проекта создай файл .env
cp .env.example .env
```

Открой `.env` и заполни своими данными:
```
TELEGRAM_API_ID=твой_api_id
TELEGRAM_API_HASH=твой_api_hash
PORT=3000
```

### 4. Запустить сервис

```bash
npm run start:dev
```

Если все правильно, увидишь:
```
🚀 Telegram Parser Service running on port 3000
```

### 5. Протестировать

Открой новый терминал и выполни:

```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+79991234567"}'
```

Замени `+79991234567` на свой номер.

Если получил ответ с `needsCode: true` - все работает! ✅

## 📚 Дальнейшие шаги

### Локальная разработка
- Читай [USAGE.md](USAGE.md) для примеров использования
- Используй [examples/test-api.http](examples/test-api.http) для тестирования в VS Code
- Запусти [examples/client.js](examples/client.js) для интерактивного теста

### Деплой на Railway
- Читай [DEPLOYMENT.md](DEPLOYMENT.md)
- Установи Railway CLI: `npm i -g @railway/cli`
- Выполни `railway login` и `railway up`

## ❓ Проблемы?

### npm install выдает ошибки

Проверь версию Node.js:
```bash
node --version  # должна быть >= 18.0.0
```

Если старая - обнови: https://nodejs.org

### Сервис не запускается

Проверь `.env` файл:
```bash
cat .env
```

Должны быть заполнены `TELEGRAM_API_ID` и `TELEGRAM_API_HASH`.

### Port 3000 уже занят

Измени в `.env`:
```
PORT=3001
```

### Ошибки TypeScript

Пересобери проект:
```bash
rm -rf dist node_modules
npm install
npm run build
```

## 📞 Тестирование API

После запуска сервиса:

1. **Авторизация**
```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+ТВОЙ_НОМЕР"}'
```

2. **Ввод кода**
```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+ТВОЙ_НОМЕР", "phoneCode": "КОД_ИЗ_SMS"}'
```

3. **Получение постов**
```bash
curl "http://localhost:3000/telegram/channel/durov/posts?sessionString=ТВОЯ_СЕССИЯ"
```

## 🎉 Готово!

Если все шаги выполнены, у тебя работающий Telegram Parser!

Следующие шаги - в [README.md](README.md) и [USAGE.md](USAGE.md).

