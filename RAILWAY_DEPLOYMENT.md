# Деплой на Railway

## Предварительные требования

1. GitHub репозиторий с кодом проекта
2. Аккаунт на [Railway.app](https://railway.app/)
3. Telegram API credentials (API_ID и API_HASH)

## Шаг 1: Подготовка репозитория

Убедись, что все изменения запушены в GitHub:

```bash
git add .
git commit -m "Ready for Railway deployment"
git push origin main
```

## Шаг 2: Создание проекта на Railway

1. Перейди на [railway.app](https://railway.app/) и войди через GitHub
2. Нажми **"New Project"**
3. Выбери **"Deploy from GitHub repo"**
4. Выбери репозиторий `tg-parser`
5. Railway автоматически определит настройки и начнет деплой

## Шаг 3: Настройка переменных окружения

1. В Railway dashboard, открой свой проект
2. Перейди в раздел **Variables**
3. Добавь следующие переменные:

```
TELEGRAM_API_ID=твой_api_id
TELEGRAM_API_HASH=твой_api_hash
PORT=3000
```

**Важно:** Не используй кавычки для значений!

## Шаг 4: Получение URL приложения

1. Railway автоматически создаст домен для твоего приложения
2. Перейди в раздел **Settings** → **Domains**
3. Нажми **"Generate Domain"**
4. Скопируй URL, например: `https://tg-parser-production.up.railway.app`

## Шаг 5: Проверка деплоя

Проверь, что сервер работает:

```bash
curl https://твой-домен.railway.app/telegram/auth
```

Должен вернуться JSON с инструкциями по использованию.

## Шаг 6: Авторизация на продакшене

Теперь нужно пройти авторизацию и получить session string:

### 1. Запроси код

```bash
curl -X POST https://твой-домен.railway.app/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+79991234567"}'
```

### 2. Введи код из SMS

```bash
curl -X POST https://твой-домен.railway.app/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+79991234567", "phoneCode": "12345"}'
```

### 3. (Если нужен 2FA) Введи пароль

```bash
curl -X POST https://твой-домен.railway.app/telegram/auth \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+79991234567", "phoneCode": "12345", "password": "твой_пароль"}'
```

### 4. Сохрани session string

Ответ будет содержать `sessionString` - **сохрани его**, он понадобится для n8n.

**⚠️ ВАЖНО:** Session string действителен пока сервер не перезапустится. После рестарта нужно авторизоваться заново.

## Автоматическая пересборка

Railway автоматически пересобирает и деплоит проект при каждом push в main ветку.

## Просмотр логов

Чтобы посмотреть логи:
1. Открой проект в Railway dashboard
2. Перейди в раздел **Deployments**
3. Нажми на последний деплой
4. Увидишь логи в реальном времени

## Проблемы и решения

### Сервер не стартует

Проверь логи на Railway. Обычно проблема в:
- Отсутствующих переменных окружения
- Ошибках в коде

### Session потерян после рестарта

Это нормально - сессии хранятся в памяти. После рестарта нужно заново пройти авторизацию.

В будущем можно добавить хранение сессий в базе данных или Redis.

### Ошибка "Cannot find module"

Railway использует только `dependencies` из `package.json`. Убедись, что все необходимые пакеты в `dependencies`, а не в `devDependencies`.

## Следующие шаги

Теперь можешь настроить n8n для работы с твоим API. См. [N8N_WORKFLOW_GUIDE.md](./N8N_WORKFLOW_GUIDE.md).



