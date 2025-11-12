@echo off
REM Скрипт быстрой настройки Telegram Parser для Windows

echo 🚀 Настройка Telegram Parser Service...
echo.

REM Проверка Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js не установлен. Установи с https://nodejs.org
    pause
    exit /b 1
)

echo ✅ Node.js установлен
echo.

REM Установка зависимостей
echo 📦 Устанавливаю зависимости...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo ❌ Ошибка установки зависимостей
    pause
    exit /b 1
)

echo ✅ Зависимости установлены
echo.

REM Создание .env файла
if not exist .env (
    echo 📝 Создаю .env файл...
    copy .env.example .env
    echo ✅ .env файл создан
    echo.
    echo ⚠️  ВАЖНО: Заполни .env файл своими Telegram API credentials!
    echo.
    echo Как получить credentials:
    echo 1. Открой https://my.telegram.org
    echo 2. Войди по номеру телефона
    echo 3. Перейди в 'API development tools'
    echo 4. Создай приложение и скопируй api_id и api_hash
    echo 5. Вставь их в файл .env
    echo.
) else (
    echo ✅ .env файл уже существует
    echo.
)

echo 🎉 Настройка завершена!
echo.
echo Следующие шаги:
echo 1. Отредактируй .env файл (если еще не сделал)
echo 2. Запусти: npm run start:dev
echo 3. Протестируй API
echo.
echo 📚 Документация: README.md, QUICKSTART.md, USAGE.md
echo.

pause

