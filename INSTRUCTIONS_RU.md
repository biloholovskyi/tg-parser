# 📋 Что тебе нужно сделать СЕЙЧАС

Проект полностью готов. Осталось 4 простых шага.

## ✅ Шаг 1: Установи зависимости (2 минуты)

### Автоматически:

**Windows:**
```cmd
setup.bat
```

**Linux/Mac:**
```bash
chmod +x setup.sh
./setup.sh
```

### Или вручную:
```bash
npm install
```

**ВАЖНО:** Если ранее уже запускал `npm install`, запусти еще раз - добавлена новая зависимость `@nestjs/config` для загрузки .env файла!

---

## ✅ Шаг 2: Получи Telegram API credentials (5 минут)

### 1. Открой в браузере:
```
https://my.telegram.org
```

### 2. Войди по номеру телефона
Введи свой номер и код из SMS

### 3. Нажми "API development tools"

### 4. Создай приложение:
- **App title:** `My Parser` (или любое)
- **Short name:** `parser`
- **Platform:** `Other`

### 5. Скопируй данные:
- **api_id** - число (например: 12345678)
- **api_hash** - строка (например: abc123def456...)

**НЕ ДЕЛИСЬ ЭТИМИ ДАННЫМИ С ДРУГИМИ!**

---

## ✅ Шаг 3: Создай .env файл (1 минута)

### Скопируй шаблон:
```bash
cp .env.example .env
```

### Открой .env и заполни:
```
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=abc123def456...
PORT=3000
```

Вставь свои значения из шага 2!

---

## ✅ Шаг 4: Запусти сервер (30 секунд)

```bash
npm run start:dev
```

Должен запуститься на `http://localhost:3000`

Если видишь:
```
🚀 Telegram Parser Service running on port 3000
```

**ПОЗДРАВЛЯЮ! ВСЕ РАБОТАЕТ!** 🎉

---

## 🧪 Шаг 5: Протестируй (опционально)

### Тест 1: Простой запрос
```bash
curl http://localhost:3000
```

### Тест 2: Начало авторизации
```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+79991234567"}'
```

Замени `+79991234567` на свой номер с кодом страны.

Если видишь `"needsCode": true` - авторизация работает!

---

## 📚 Что дальше?

### Хочу научиться использовать API:
👉 Открой **[USAGE.md](USAGE.md)**

### Хочу запустить интерактивный пример:
```bash
node examples/client.js
```

### Хочу задеплоить на Railway:
👉 Открой **[DEPLOYMENT.md](DEPLOYMENT.md)**

### Хочу понять как устроен проект:
👉 Открой **[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)**

---

## ❓ Проблемы?

### npm install выдает ошибки

**Проверь версию Node.js:**
```bash
node --version
```

Должна быть >= 18.0.0

**Обнови Node.js:**
Скачай с https://nodejs.org

### Сервер не запускается

**Проверь .env файл:**
```bash
cat .env  # Linux/Mac
type .env # Windows
```

Должны быть заполнены `TELEGRAM_API_ID` и `TELEGRAM_API_HASH`

### Port 3000 занят

**Измени порт в .env:**
```
PORT=3001
```

### Забыл где взять credentials

https://my.telegram.org → "API development tools"

---

## 📖 Полезные ссылки

- **Быстрый старт:** [QUICKSTART.md](QUICKSTART.md)
- **Примеры использования:** [USAGE.md](USAGE.md)
- **Деплой:** [DEPLOYMENT.md](DEPLOYMENT.md)
- **Структура проекта:** [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)
- **Сводка:** [SUMMARY.md](SUMMARY.md)

---

## 🎯 Checklist

- [ ] Установил зависимости (`npm install`)
- [ ] Получил Telegram API credentials
- [ ] Создал и заполнил .env файл
- [ ] Запустил сервер (`npm run start:dev`)
- [ ] Протестировал запрос

Когда все галочки стоят - переходи к [USAGE.md](USAGE.md)!

---

## 💡 Совет

Открой `examples/client.js` в редакторе и посмотри как работает API клиент. Потом запусти:

```bash
node examples/client.js
```

Это интерактивный пример который проведет тебя через весь процесс авторизации и получения постов!

---

## 🎉 Готов?

Выполни 4 шага выше и начинай использовать! 

Удачи! 🚀

