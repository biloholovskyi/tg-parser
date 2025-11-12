import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { computeCheck } from 'telegram/Password';
import { getTelegramConfig } from '../config/telegram.config';
import { TelegramPost, TelegramMedia } from './interfaces/message.interface';

interface AuthState {
  client: TelegramClient;
  phoneCodeHash: string;
  phoneNumber: string;
}

@Injectable()
export class TelegramService {
  private static instanceCount = 0;
  private instanceId: number;
  private clients: Map<string, TelegramClient> = new Map();
  private authStates: Map<string, AuthState> = new Map();
  private config: { apiId: number; apiHash: string };

  constructor() {
    // Загружаем конфигурацию после того как ConfigModule загрузил .env
    // Не валидируем при создании - только при использовании
    try {
      this.config = getTelegramConfig();
    } catch (error) {
      console.warn('[TelegramService] Config not loaded, will fail on first use:', error.message);
      this.config = { apiId: 0, apiHash: '' };
    }

    // Отслеживаем инстансы
    TelegramService.instanceCount++;
    this.instanceId = TelegramService.instanceCount;
    console.log(`[TelegramService] Created instance #${this.instanceId}`);
  }

  /**
   * Создает клиента для авторизации
   */
  private createClient(sessionString: string = ''): TelegramClient {
    const session = new StringSession(sessionString);
    return new TelegramClient(session, this.config.apiId, this.config.apiHash, {
      connectionRetries: 5,
    });
  }

  /**
   * Авторизация пользователя через телефон
   */
  async authenticate(
    phoneNumber: string,
    phoneCode?: string,
    password?: string,
  ): Promise<{
    sessionString?: string;
    needsCode?: boolean;
    needsPassword?: boolean;
    message: string;
  }> {
    // Валидация конфигурации при использовании
    if (!this.config.apiId || !this.config.apiHash) {
      throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured');
    }

    let client: TelegramClient | null = null;
    try {
      // Шаг 1: Отправка кода (если код еще не запрошен)
      if (!phoneCode) {
        client = this.createClient();

        // Таймаут для подключения (30 секунд)
        const connectPromise = client.connect();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), 30000),
        );

        await Promise.race([connectPromise, timeoutPromise]);

        // Таймаут для отправки кода (30 секунд)
        // sendCode принимает apiId и apiHash как параметры конструктора, не здесь
        const sendCodePromise = client.sendCode(
          {
            apiId: this.config.apiId,
            apiHash: this.config.apiHash,
          },
          phoneNumber,
        );
        const sendCodeTimeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Send code timeout')), 30000),
        );

        const result = (await Promise.race([sendCodePromise, sendCodeTimeoutPromise])) as any;

        // Сохраняем состояние для следующего запроса
        this.authStates.set(phoneNumber, {
          client: client!,
          phoneCodeHash: result.phoneCodeHash,
          phoneNumber,
        });

        return {
          needsCode: true,
          message: 'Phone code has been sent to your phone. Please provide the code.',
        };
      }

      // Шаг 2: Проверка кода
      const authState = this.authStates.get(phoneNumber);
      if (!authState) {
        throw new Error('Please request code first by sending phoneNumber without code');
      }

      try {
        // Таймаут для проверки кода (30 секунд)
        const signInPromise = authState.client.invoke(
          new Api.auth.SignIn({
            phoneNumber: phoneNumber,
            phoneCodeHash: authState.phoneCodeHash,
            phoneCode: phoneCode,
          }),
        );
        const signInTimeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Sign in timeout')), 30000),
        );

        await Promise.race([signInPromise, signInTimeoutPromise]);

        // Успешная авторизация
        const sessionString = (authState.client.session as StringSession).save();

        // Сохраняем клиента под session string
        this.clients.set(sessionString, authState.client);
        this.authStates.delete(phoneNumber);

        console.log(`[authenticate] Instance #${this.instanceId}: ✅ Client saved successfully`);
        console.log('[authenticate] Session string length:', sessionString.length);
        console.log('[authenticate] Total cached clients:', this.clients.size);
        console.log(
          '[authenticate] Clients Map keys:',
          Array.from(this.clients.keys()).map((k) => k.substring(0, 20)),
        );

        return {
          sessionString,
          message: 'Successfully authenticated',
        };
      } catch (error) {
        // Нужен 2FA пароль
        if (error.message.includes('SESSION_PASSWORD_NEEDED')) {
          if (!password) {
            return {
              needsPassword: true,
              message: '2FA password is required.',
            };
          }

          // Шаг 3: Проверка 2FA пароля
          const getPasswordPromise = authState.client.invoke(new Api.account.GetPassword());
          const getPasswordTimeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Get password timeout')), 30000),
          );
          const passwordInfo = (await Promise.race([
            getPasswordPromise,
            getPasswordTimeoutPromise,
          ])) as any;

          // Вычисляем SRP hash для пароля
          const passwordSrp = await computeCheck(passwordInfo, password);

          const checkPasswordPromise = authState.client.invoke(
            new Api.auth.CheckPassword({
              password: passwordSrp,
            }),
          );
          const checkPasswordTimeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Check password timeout')), 30000),
          );
          await Promise.race([checkPasswordPromise, checkPasswordTimeoutPromise]);

          const sessionString = (authState.client.session as StringSession).save();

          // Сохраняем клиента под session string
          this.clients.set(sessionString, authState.client);
          this.authStates.delete(phoneNumber);

          console.log(
            `[authenticate] Instance #${this.instanceId}: ✅ Client saved successfully (2FA)`,
          );
          console.log('[authenticate] Session string length:', sessionString.length);
          console.log('[authenticate] Total cached clients:', this.clients.size);
          console.log(
            '[authenticate] Clients Map keys:',
            Array.from(this.clients.keys()).map((k) => k.substring(0, 20)),
          );

          return {
            sessionString,
            message: 'Successfully authenticated',
          };
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('Authentication error:', error);

      // Очистка состояния при ошибке
      const authState = this.authStates.get(phoneNumber);
      if (authState) {
        try {
          await authState.client.disconnect().catch(() => {});
        } catch (e) {
          // Игнорируем ошибки при отключении
        }
        this.authStates.delete(phoneNumber);
      }

      // Очистка клиента, если он был создан, но не сохранен
      if (client && !this.clients.has((client.session as StringSession).save())) {
        try {
          await client.disconnect().catch(() => {});
        } catch (e) {
          // Игнорируем ошибки при отключении
        }
      }

      const errorMessage = error.message || 'Unknown error';
      throw new BadRequestException(`Authentication failed: ${errorMessage}`);
    }
  }

  /**
   * Получает клиента из кэша
   * ВАЖНО: Клиент должен быть создан через authenticate() перед использованием
   */
  private getClient(sessionString: string): TelegramClient {
    // Очищаем от пробелов/переносов
    const cleanSession = sessionString.trim();

    console.log(`[getClient] Instance #${this.instanceId}: Looking for cached client...`);
    console.log('[getClient] Total cached clients:', this.clients.size);
    console.log(
      '[getClient] Clients Map keys:',
      Array.from(this.clients.keys()).map((k) => k.substring(0, 20)),
    );

    // Показываем сохраненные сессии
    if (this.clients.size > 0) {
      console.log('[getClient] Full comparison:');
      for (const key of this.clients.keys()) {
        const match = key === cleanSession;
        console.log(`  Cached (full): "${key}"`);
        console.log(`  Looking (full): "${cleanSession}"`);
        console.log(`  Match: ${match}`);

        // Если не совпадает - найдем где именно
        if (!match && key.length === cleanSession.length) {
          for (let i = 0; i < key.length; i++) {
            if (key[i] !== cleanSession[i]) {
              console.log(`  First diff at position ${i}:`);
              console.log(`    Cached char: '${key[i]}' (code: ${key.charCodeAt(i)})`);
              console.log(
                `    Looking char: '${cleanSession[i]}' (code: ${cleanSession.charCodeAt(i)})`,
              );
              break;
            }
          }
        }
      }
    }

    if (!this.clients.has(cleanSession)) {
      console.error('[getClient] ❌ Client not found in cache!');
      throw new BadRequestException(
        'Session not found. Please authenticate first using POST /telegram/auth',
      );
    }

    console.log('[getClient] ✅ Found cached client');
    return this.clients.get(cleanSession);
  }

  /**
   * Получает посты из канала за указанный период
   */
  async getChannelPosts(
    channelUsername: string,
    sessionString: string,
    hoursBack: number = 24,
  ): Promise<{ posts: TelegramPost[]; count: number }> {
    console.log(
      `[getChannelPosts] Start fetching posts from @${channelUsername} (last ${hoursBack} hours)`,
    );

    try {
      console.log('[getChannelPosts] Getting client from session...');
      const client = this.getClient(sessionString);
      console.log('[getChannelPosts] Client obtained successfully');

      // Убеждаемся, что клиент подключен
      if (!client.connected) {
        console.log('[getChannelPosts] Client not connected, connecting...');
        await client.connect();
      }

      // Вычисляем время начала периода
      const startTime = Math.floor(Date.now() / 1000) - hoursBack * 3600;
      console.log(
        `[getChannelPosts] Filtering posts after: ${new Date(startTime * 1000).toISOString()}`,
      );

      const posts: TelegramPost[] = [];

      // Получаем сообщения из канала (увеличиваем лимит для больших периодов)
      const limit = Math.min(200, hoursBack * 10); // Динамический лимит на основе периода

      console.log(`[getChannelPosts] Starting to iterate messages (limit: ${limit})...`);

      let messageCount = 0;
      for await (const message of client.iterMessages(channelUsername, {
        limit,
      })) {
        messageCount++;

        if (messageCount === 1) {
          console.log('[getChannelPosts] First message received');
        }

        // Проверяем, что сообщение не старше указанного периода
        if (message.date < startTime) {
          console.log(
            `[getChannelPosts] Message ${messageCount} is older than ${hoursBack}h, stopping`,
          );
          break;
        }

        const post = this.parseMessage(message, channelUsername);
        if (post) {
          posts.push(post);
        }

        if (messageCount % 10 === 0) {
          console.log(
            `[getChannelPosts] Processed ${messageCount} messages, found ${posts.length} posts`,
          );
        }
      }

      console.log(
        `[getChannelPosts] Finished! Total messages: ${messageCount}, posts in last ${hoursBack}h: ${posts.length}`,
      );

      return {
        posts,
        count: posts.length,
      };
    } catch (error) {
      console.error('[getChannelPosts] Error:', error);
      console.error('[getChannelPosts] Error message:', error.message);
      console.error('[getChannelPosts] Error stack:', error.stack);

      if (error.message?.includes('USERNAME_INVALID')) {
        throw new BadRequestException('Invalid channel username');
      }
      if (error.message?.includes('CHANNEL_PRIVATE')) {
        throw new BadRequestException('Channel is private and you are not a member');
      }
      if (error.message?.includes('No user has')) {
        throw new BadRequestException(
          `Channel @${channelUsername} not found or you don't have access`,
        );
      }

      throw new InternalServerErrorException(`Failed to get posts: ${error.message}`);
    }
  }

  /**
   * Парсит сообщение в формат TelegramPost
   */
  private parseMessage(message: any, channelUsername: string): TelegramPost | null {
    if (!message) return null;

    const media: TelegramMedia[] = [];

    if (message.media) {
      if (message.photo) {
        media.push({ type: 'photo' });
      } else if (message.video) {
        media.push({ type: 'video' });
      } else if (message.document) {
        media.push({ type: 'document' });
      }
    }

    // Генерируем прямую ссылку на пост
    const postUrl = `https://t.me/${channelUsername}/${message.id}`;

    return {
      id: message.id,
      text: message.message || '',
      date: new Date(message.date * 1000),
      media,
      postUrl,
    };
  }

  /**
   * Отключает клиента
   */
  async disconnect(sessionString: string): Promise<void> {
    const client = this.clients.get(sessionString);
    if (client) {
      await client.disconnect();
      this.clients.delete(sessionString);
    }
  }
}
