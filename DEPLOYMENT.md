# Инструкция по деплою на Railway

## Шаг 1: Подготовка

Убедись, что у тебя установлен Railway CLI:

```bash
npm install -g @railway/cli
```

## Шаг 2: Авторизация в Railway

```bash
railway login
```

Откроется браузер для авторизации. Войди через GitHub.

## Шаг 3: Инициализация проекта

В корне проекта выполни:

```bash
railway init
```

Выбери:
- "Create a new project" если это новый проект
- Введи имя проекта (например "telegram-parser")

## Шаг 4: Добавление переменных окружения

### Через CLI:

```bash
railway variables set TELEGRAM_API_ID=твой_api_id
railway variables set TELEGRAM_API_HASH=твой_api_hash
```

### Через Dashboard:

1. Открой Railway Dashboard: https://railway.app/dashboard
2. Выбери свой проект
3. Перейди в раздел "Variables"
4. Добавь:
   - `TELEGRAM_API_ID` = твой API ID
   - `TELEGRAM_API_HASH` = твой API Hash

## Шаг 5: Деплой

```bash
railway up
```

Railway автоматически:
- Обнаружит Node.js проект
- Установит зависимости из package.json
- Соберет проект (npm run build)
- Запустит сервис (npm run start:prod)

## Шаг 6: Получение публичного домена

После успешного деплоя добавь публичный домен:

```bash
railway domain
```

Или через Dashboard:
1. Открой свой проект
2. Перейди в "Settings" → "Networking"
3. Нажми "Generate Domain"

Получишь URL типа: `https://telegram-parser-production.up.railway.app`

## Проверка работы

Проверь, что сервис работает:

```bash
curl https://твой-домен.railway.app
```

## Логи

Смотри логи:

```bash
railway logs
```

Или в Dashboard → "Deployments" → выбери деплой → "View Logs"

## Обновление

При каждом новом деплое просто выполни:

```bash
railway up
```

Или настрой автоматический деплой из GitHub:
1. Push код в GitHub репозиторий
2. В Railway Dashboard подключи GitHub repo
3. Каждый push в main ветку будет автоматически деплоиться

## Troubleshooting

### Ошибка "TELEGRAM_API_ID is not configured"

Проверь переменные окружения:

```bash
railway variables
```

Если их нет - добавь через `railway variables set`.

### Проблемы с сессией

Сессии хранятся в памяти и сбрасываются при перезапуске. Для production рекомендуется:
- Использовать Redis для хранения сессий
- Или сохранять сессии в базе данных

### Port уже используется

Railway автоматически устанавливает переменную `PORT`. Код уже использует `process.env.PORT || 3000`.

## Полезные команды

```bash
# Открыть Dashboard
railway open

# Просмотр всех переменных
railway variables

# Просмотр статуса
railway status

# Удалить проект
railway delete
```

## Стоимость

Railway предоставляет $5 бесплатных кредитов каждый месяц. Этого достаточно для небольшого проекта. Следи за использованием в Dashboard.

