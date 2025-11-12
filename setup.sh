#!/bin/bash

# Скрипт быстрой настройки Telegram Parser

echo "🚀 Настройка Telegram Parser Service..."
echo ""

# Проверка Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js не установлен. Установи с https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "⚠️  Нужен Node.js >= 18.0.0. У тебя: $(node -v)"
    echo "Обнови с https://nodejs.org"
    exit 1
fi

echo "✅ Node.js $(node -v) установлен"
echo ""

# Установка зависимостей
echo "📦 Устанавливаю зависимости..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Ошибка установки зависимостей"
    exit 1
fi

echo "✅ Зависимости установлены"
echo ""

# Создание .env файла
if [ ! -f .env ]; then
    echo "📝 Создаю .env файл..."
    cp .env.example .env
    echo "✅ .env файл создан"
    echo ""
    echo "⚠️  ВАЖНО: Заполни .env файл своими Telegram API credentials!"
    echo ""
    echo "Как получить credentials:"
    echo "1. Открой https://my.telegram.org"
    echo "2. Войди по номеру телефона"
    echo "3. Перейди в 'API development tools'"
    echo "4. Создай приложение и скопируй api_id и api_hash"
    echo "5. Вставь их в файл .env"
    echo ""
else
    echo "✅ .env файл уже существует"
    echo ""
fi

# Проверка .env
if grep -q "your_api_id_here" .env 2>/dev/null; then
    echo "⚠️  .env файл не настроен! Отредактируй его перед запуском."
    echo ""
fi

echo "🎉 Настройка завершена!"
echo ""
echo "Следующие шаги:"
echo "1. Отредактируй .env файл (если еще не сделал)"
echo "2. Запусти: npm run start:dev"
echo "3. Протестируй: curl -X POST http://localhost:3000/telegram/auth -H 'Content-Type: application/json' -d '{\"phoneNumber\": \"+79991234567\"}'"
echo ""
echo "📚 Документация: README.md, QUICKSTART.md, USAGE.md"
echo ""

