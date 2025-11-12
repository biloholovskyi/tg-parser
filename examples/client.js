/**
 * Пример клиента для Telegram Parser API
 * Использование: node examples/client.js
 */

const API_URL = 'http://localhost:3000';

// Замени на свои данные
const PHONE_NUMBER = '+79991234567';
const CHANNEL_USERNAME = 'durov';

class TelegramParserClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionString = null;
  }

  async authenticate(phoneNumber, phoneCode = null, password = null) {
    const response = await fetch(`${this.baseUrl}/telegram/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumber,
        phoneCode,
        password,
      }),
    });

    const data = await response.json();
    
    if (data.sessionString) {
      this.sessionString = data.sessionString;
      console.log('✅ Авторизация успешна!');
      console.log('Session string:', this.sessionString);
    }

    return data;
  }

  async getChannelPosts(channelUsername) {
    if (!this.sessionString) {
      throw new Error('Нужно сначала авторизоваться');
    }

    const response = await fetch(
      `${this.baseUrl}/telegram/channel/${channelUsername}/posts?sessionString=${this.sessionString}`
    );

    return await response.json();
  }
}

// Интерактивная авторизация
async function interactiveAuth() {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (query) => new Promise((resolve) => readline.question(query, resolve));

  const client = new TelegramParserClient(API_URL);

  console.log('🚀 Начинаем авторизацию...\n');

  // Шаг 1: Номер телефона
  const phoneNumber = await question('Введи номер телефона (с +): ');
  let result = await client.authenticate(phoneNumber);

  if (result.needsCode) {
    // Шаг 2: Код из SMS
    console.log('\n📱 Код отправлен на твой телефон');
    const phoneCode = await question('Введи код: ');
    result = await client.authenticate(phoneNumber, phoneCode);
  }

  if (result.needsPassword) {
    // Шаг 3: 2FA пароль
    console.log('\n🔒 Требуется 2FA пароль');
    const password = await question('Введи пароль: ');
    result = await client.authenticate(phoneNumber, phoneCode, password);
  }

  if (result.sessionString) {
    // Успех!
    console.log('\n✅ Авторизация завершена!');
    console.log('\nТеперь получим посты...\n');

    const channelUsername = await question(`Введи username канала (по умолчанию: ${CHANNEL_USERNAME}): `) || CHANNEL_USERNAME;
    
    const posts = await client.getChannelPosts(channelUsername);
    
    console.log(`\n📊 Найдено постов за последние 24 часа: ${posts.count}\n`);
    
    posts.posts.forEach((post, index) => {
      console.log(`--- Пост #${index + 1} ---`);
      console.log(`ID: ${post.id}`);
      console.log(`Дата: ${new Date(post.date).toLocaleString('ru-RU')}`);
      console.log(`Текст: ${post.text.substring(0, 100)}${post.text.length > 100 ? '...' : ''}`);
      console.log(`Медиа: ${post.media.length > 0 ? post.media.map(m => m.type).join(', ') : 'нет'}`);
      console.log('');
    });
  }

  readline.close();
}

// Запуск
if (require.main === module) {
  interactiveAuth().catch(console.error);
}

module.exports = TelegramParserClient;

