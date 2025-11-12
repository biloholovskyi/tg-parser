# Структура проекта

```
tg-parser/
│
├── src/                              # Исходный код
│   ├── main.ts                       # Entry point приложения
│   ├── app.module.ts                 # Корневой модуль NestJS
│   │
│   ├── config/                       # Конфигурация
│   │   └── telegram.config.ts        # Настройки Telegram API
│   │
│   └── telegram/                     # Telegram модуль
│       ├── telegram.module.ts        # Модуль
│       ├── telegram.service.ts       # Бизнес-логика (GramJS)
│       ├── telegram.controller.ts    # REST API endpoints
│       │
│       ├── dto/                      # Data Transfer Objects
│       │   ├── auth.dto.ts          # DTO для авторизации
│       │   └── messages.dto.ts      # DTO для сообщений
│       │
│       └── interfaces/               # TypeScript интерфейсы
│           └── message.interface.ts  # Типы для постов и медиа
│
├── examples/                         # Примеры использования
│   ├── test-api.http                # HTTP запросы для REST Client
│   └── client.js                    # Node.js клиент
│
├── .vscode/                          # VS Code конфигурация
│   ├── settings.json                # Настройки форматирования
│   └── launch.json                  # Debug конфигурация
│
├── dist/                             # Скомпилированный код (создается после build)
│
├── node_modules/                     # Зависимости (создается после npm install)
│
├── .env                              # Environment variables (создай сам!)
├── .env.example                      # Пример .env файла
├── .gitignore                        # Git ignore файл
├── .prettierrc                       # Prettier конфигурация
├── .eslintrc.js                      # ESLint конфигурация
│
├── package.json                      # NPM зависимости и скрипты
├── tsconfig.json                     # TypeScript конфигурация
├── nest-cli.json                     # NestJS CLI конфигурация
├── railway.toml                      # Railway деплой конфигурация
│
├── README.md                         # Основная документация
├── QUICKSTART.md                     # Быстрый старт
├── USAGE.md                          # Руководство по использованию
├── DEPLOYMENT.md                     # Инструкции по деплою
└── PROJECT_STRUCTURE.md              # Этот файл
```

## Описание ключевых файлов

### Конфигурация

- **package.json** - зависимости и npm скрипты
- **tsconfig.json** - настройки TypeScript компилятора
- **nest-cli.json** - настройки NestJS CLI
- **.env** - переменные окружения (API credentials)

### Исходный код

#### src/main.ts
Bootstrap функция, запускает NestJS приложение на указанном порту.

#### src/app.module.ts
Корневой модуль, импортирует все остальные модули.

#### src/telegram/telegram.service.ts
**Ключевой файл!** Содержит всю логику работы с Telegram:
- Создание клиентов GramJS
- Авторизация пользователей
- Получение сообщений из каналов
- Парсинг медиа

#### src/telegram/telegram.controller.ts
REST API endpoints:
- `POST /telegram/auth` - авторизация
- `GET /telegram/channel/:username/posts` - получение постов

#### src/telegram/dto/
Data Transfer Objects для валидации входящих данных.

#### src/telegram/interfaces/
TypeScript типы для типобезопасности.

### Документация

- **README.md** - общая информация и документация
- **QUICKSTART.md** - быстрый старт для нетерпеливых
- **USAGE.md** - детальное руководство по использованию
- **DEPLOYMENT.md** - инструкции по деплою на Railway

### Примеры

- **examples/test-api.http** - готовые HTTP запросы
- **examples/client.js** - JavaScript клиент для API

## Поток данных

```
1. Клиент → POST /telegram/auth
   ↓
2. TelegramController.authenticate()
   ↓
3. TelegramService.authenticate() → GramJS
   ↓
4. Telegram API → отправляет код
   ↓
5. Клиент → POST /telegram/auth (с кодом)
   ↓
6. Получает sessionString
   ↓
7. Клиент → GET /channel/:username/posts?sessionString=...
   ↓
8. TelegramController.getChannelPosts()
   ↓
9. TelegramService.getLast24HoursPosts()
   ↓
10. GramJS → Telegram API → получает сообщения
    ↓
11. Парсинг и форматирование
    ↓
12. JSON ответ клиенту
```

## Масштабирование

Текущая архитектура позволяет легко добавить:

### Новые модули
```
src/
├── auth/              # Аутентификация через API keys
├── database/          # Интеграция с БД
├── storage/           # Хранение медиа
└── webhooks/          # Уведомления о новых постах
```

### Новые сервисы в telegram/
```
telegram/
├── telegram.service.ts        # Основная логика
├── session.service.ts         # Управление сессиями
├── media.service.ts          # Скачивание медиа
└── scheduler.service.ts      # Планировщик задач
```

### Новые endpoints
Просто добавь методы в `telegram.controller.ts`:
```typescript
@Get('channel/:username/search')
async searchInChannel() { ... }

@Post('channel/:username/download-media')
async downloadMedia() { ... }
```

## Зависимости

### Production
- `@nestjs/*` - NestJS фреймворк
- `telegram` - GramJS библиотека для Telegram
- `reflect-metadata` - для декораторов
- `rxjs` - реактивное программирование

### Development
- `typescript` - TypeScript компилятор
- `@typescript-eslint/*` - линтер
- `prettier` - форматирование кода
- `@nestjs/cli` - NestJS инструменты

## Команды

```bash
# Разработка
npm run start:dev       # С hot-reload

# Продакшн
npm run build          # Компиляция
npm run start:prod     # Запуск скомпилированной версии

# Утилиты
npm run format         # Форматирование кода
npm run lint           # Проверка кода
```

