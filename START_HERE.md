# 🎯 НАЧНИ ОТСЮДА

## Что это?

Telegram Parser Service - сервис на NestJS для парсинга открытых и закрытых Telegram каналов через твой личный аккаунт.

## 🚀 Быстрый старт (5 минут)

### Windows
Просто запусти:
```cmd
setup.bat
```

### Linux/Mac
```bash
chmod +x setup.sh
./setup.sh
```

### Или вручную:

#### 1. Установи зависимости
```bash
npm install
```

#### 2. Настрой .env
```bash
cp .env.example .env
```

Отредактируй `.env` и вставь свои Telegram API credentials:
```
TELEGRAM_API_ID=твой_api_id
TELEGRAM_API_HASH=твой_api_hash
PORT=3000
```

**Где взять credentials?** → [Инструкция ниже](#как-получить-telegram-api-credentials)

#### 3. Запусти
```bash
npm run start:dev
```

Должен запуститься на `http://localhost:3000`

#### 4. Протестируй

```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+79991234567"}'
```

Если видишь `needsCode: true` - работает! ✅

---

## 📖 Документация

Выбери что тебе нужно:

### Хочу быстро запустить
👉 **[QUICKSTART.md](QUICKSTART.md)** - 5 минут от установки до первого запроса

### Хочу разобраться как использовать
👉 **[USAGE.md](USAGE.md)** - детальное руководство с примерами

### Хочу задеплоить на Railway
👉 **[DEPLOYMENT.md](DEPLOYMENT.md)** - пошаговая инструкция деплоя

### Хочу понять архитектуру
👉 **[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)** - структура проекта

### Хочу посмотреть что реализовано
👉 **[SUMMARY.md](SUMMARY.md)** - полная сводка проекта

### Основная документация
👉 **[README.md](README.md)** - общая информация

---

## 🔑 Как получить Telegram API credentials

### Шаг 1: Перейди на сайт
Открой: https://my.telegram.org

### Шаг 2: Войди
Введи свой номер телефона и код из SMS

### Шаг 3: API Development Tools
Нажми на **"API development tools"**

### Шаг 4: Создай приложение
Заполни форму:
- **App title:** любое название (например "My Parser")
- **Short name:** короткое имя (например "parser")
- **Platform:** выбери "Other"
- Остальное можно оставить пустым

### Шаг 5: Скопируй credentials
После создания ты увидишь:
- **api_id** - число (например: 12345678)
- **api_hash** - строка из 32 символов (например: a1b2c3d4e5f6...)

### Шаг 6: Вставь в .env
```
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=a1b2c3d4e5f6...
```

**ВАЖНО:** Никому не показывай эти данные!

---

## 📡 API Endpoints

### POST /telegram/auth
Авторизация и получение session string

**Пример:**
```bash
curl -X POST http://localhost:3000/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+79991234567", "phoneCode": "12345"}'
```

### GET /telegram/channel/:username/posts
Получение постов канала за 24 часа

**Пример:**
```bash
curl "http://localhost:3000/telegram/channel/durov/posts?sessionString=YOUR_SESSION"
```

---

## 🎓 Примеры

### REST Client (VS Code)
Открой `examples/test-api.http` в VS Code с расширением REST Client

### Node.js клиент
```bash
node examples/client.js
```

Интерактивная авторизация с примерами

---

## ❓ Частые вопросы

### Сервис не запускается
- Проверь `.env` файл - заполнены ли `TELEGRAM_API_ID` и `TELEGRAM_API_HASH`
- Проверь версию Node.js: `node --version` (нужна >= 18.0.0)

### Session expired
- Session хранится в памяти
- После перезапуска сервера нужно авторизоваться заново
- Для production используй Redis/PostgreSQL

### Invalid channel username
- Username указывай без `@`
- Для закрытых каналов нужно быть участником
- Проверь что канал существует

### Port 3000 уже занят
Измени в `.env`:
```
PORT=3001
```

---

## 🛠️ Команды разработки

```bash
# Разработка (с hot-reload)
npm run start:dev

# Продакшн (сборка и запуск)
npm run build
npm run start:prod

# Форматирование кода
npm run format

# Проверка кода
npm run lint
```

---

## 🚂 Деплой на Railway

```bash
# Установи Railway CLI
npm i -g @railway/cli

# Залогинься
railway login

# Инициализируй проект
railway init

# Задеплой
railway up
```

Подробности в [DEPLOYMENT.md](DEPLOYMENT.md)

---

## 🎯 Что делать дальше?

1. ✅ Установил зависимости
2. ✅ Настроил .env
3. ✅ Запустил сервер
4. ✅ Протестировал API

**Теперь:**
- Изучи [USAGE.md](USAGE.md) для продвинутых примеров
- Задеплой на Railway - [DEPLOYMENT.md](DEPLOYMENT.md)
- Добавь свои фичи - [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)

---

## 📞 Поддержка

- Все инструкции в папке с проектом
- Примеры кода в `examples/`
- Документация в `.md` файлах

---

## 📊 Структура файлов

```
tg-parser/
├── START_HERE.md          ← ТЫ ЗДЕСЬ
├── README.md              ← Основная документация
├── QUICKSTART.md          ← Быстрый старт
├── USAGE.md               ← Как использовать
├── DEPLOYMENT.md          ← Как задеплоить
├── PROJECT_STRUCTURE.md   ← Архитектура
├── SUMMARY.md             ← Сводка проекта
├── TODO_FOR_USER.md       ← Что тебе нужно сделать
│
├── src/                   ← Исходный код
├── examples/              ← Примеры использования
├── package.json           ← Зависимости
├── .env.example           ← Пример конфигурации
└── railway.toml           ← Конфиг для Railway
```

---

## ✨ Особенности

- ✅ Современный стек (NestJS 10 + TypeScript 5)
- ✅ Работа с личным аккаунтом (не бот)
- ✅ Доступ к закрытым каналам
- ✅ Простой REST API
- ✅ Готово к деплою на Railway
- ✅ Полная документация

---

## 🎉 Готов начать?

Выполни быстрый старт в начале этого файла и переходи к [USAGE.md](USAGE.md)!

