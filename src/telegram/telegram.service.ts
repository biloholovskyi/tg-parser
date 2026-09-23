import {
  Injectable,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { computeCheck } from 'telegram/Password';
import { Logger as GramLogger, LogLevel } from 'telegram/extensions/Logger';
import { getTelegramConfig } from '../config/telegram.config';
import { MS_IN_SECOND } from '../shared/constants/rate-limit.constants';
import { HOURS_BACK_DEFAULT } from './dto/messages.dto';
import { GetPostsResponse, TelegramMedia, TelegramPost } from './interfaces/message.interface';
import {
  AUTH_STATE_SWEEP_INTERVAL_MS,
  AUTH_STATE_TTL_MS,
  CONNECTION_LABEL,
  CONNECTION_RETRIES_COUNT,
  EXTERNAL_CALL_TIMEOUT_MS,
  FLOOD_SLEEP_THRESHOLD_S,
  POSTS_MAX_MESSAGES,
  POSTS_PAGE_SIZE,
  REQUEST_RETRIES_COUNT,
  RETRY_DELAY_MS,
  SESSION_CACHE_IDLE_TTL_MS,
  SESSION_CACHE_MAX_ENTRIES,
  SECONDS_IN_HOUR,
  SESSION_CACHE_SWEEP_INTERVAL_MS,
} from './constants';
import { SessionClientCache } from './utils/session-client-cache';
import {
  describeError,
  invalidSessionException,
  isInvalidSessionError,
  missingConfigException,
  toHttpException,
} from './utils/telegram-errors';
import { withTimeout } from './utils/with-timeout';

const CODE_NOT_REQUESTED_MESSAGE = 'Request a code first by sending phoneNumber without a code';

interface AuthState {
  client: TelegramClient;
  phoneCodeHash: string;
  phoneNumber: string;
  createdAt: number;
}

@Injectable()
export class TelegramService implements OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly clients = new SessionClientCache<TelegramClient>({
    maxEntries: SESSION_CACHE_MAX_ENTRIES,
    idleTtlMs: SESSION_CACHE_IDLE_TTL_MS,
    sweepIntervalMs: SESSION_CACHE_SWEEP_INTERVAL_MS,
  });
  private authStates: Map<string, AuthState> = new Map();
  private readonly authStateSweepTimer: NodeJS.Timeout;
  private config: { apiId: number; apiHash: string };
  private readonly dataDir = path.join(process.cwd(), 'data');
  private readonly authStatesFile = path.join(process.cwd(), 'data', 'auth-states.json');
  private readonly sessionsFile = path.join(process.cwd(), 'data', 'sessions.json');

  constructor() {
    this.ensureDataDir();

    // Загружаем конфигурацию после того как ConfigModule загрузил .env
    // Не валидируем при создании - только при использовании
    try {
      this.config = getTelegramConfig();
    } catch (error: unknown) {
      this.logger.warn(`Config not loaded, will fail on first use: ${describeError(error)}`);
      this.config = { apiId: 0, apiHash: '' };
    }

    this.authStateSweepTimer = setInterval(
      () => this.sweepExpiredAuthStates(),
      AUTH_STATE_SWEEP_INTERVAL_MS,
    );
    this.authStateSweepTimer.unref();
    this.clients.startSweeping();
  }

  /**
   * Releases every cached and pending client and stops the background sweeps.
   */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.authStateSweepTimer);
    const pending = [...this.authStates.values()].map((state) => releaseClient(state.client));
    this.authStates.clear();
    await Promise.all([this.clients.close(), ...pending]);
  }

  /** A concurrent request may have stored its own pending client meanwhile; release it before overwriting. */
  private async releaseReplacedAuthState(
    phoneNumber: string,
    client: TelegramClient,
  ): Promise<void> {
    const replaced = this.authStates.get(phoneNumber);
    if (replaced && replaced.client !== client) {
      await releaseClient(replaced.client);
    }
  }

  private sweepExpiredAuthStates(): void {
    const now = Date.now();
    for (const [phone, state] of this.authStates) {
      if (now - state.createdAt > AUTH_STATE_TTL_MS) {
        void releaseClient(state.client);
        this.authStates.delete(phone);
        this.deleteAuthState(phone);
      }
    }
  }

  /**
   * Создает клиента для авторизации
   */
  private createClient(sessionString: string = ''): TelegramClient {
    const session = new StringSession(sessionString);
    return new TelegramClient(session, this.config.apiId, this.config.apiHash, {
      floodSleepThreshold: FLOOD_SLEEP_THRESHOLD_S,
      connectionRetries: CONNECTION_RETRIES_COUNT,
      requestRetries: REQUEST_RETRIES_COUNT,
      retryDelay: RETRY_DELAY_MS,
      autoReconnect: true,
      // GramJS prints to the console on its own; keep it to errors so it cannot flood the billed log.
      baseLogger: new GramLogger(LogLevel.ERROR),
    });
  }

  /** Connects a freshly created client, releasing it if the connection fails. */
  private async connectOrRelease(client: TelegramClient): Promise<void> {
    try {
      await withTimeout(client.connect(), EXTERNAL_CALL_TIMEOUT_MS, CONNECTION_LABEL);
    } catch (error: unknown) {
      await releaseClient(client);
      throw error;
    }
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
      throw missingConfigException();
    }

    let client: TelegramClient | null = null;
    try {
      // Шаг 1: Отправка кода (если код еще не запрошен)
      if (!phoneCode) {
        // Если уже есть незавершённый authState — отключаем старый клиент
        const existingState = this.authStates.get(phoneNumber);
        if (existingState) {
          void releaseClient(existingState.client);
          this.authStates.delete(phoneNumber);
          this.deleteAuthState(phoneNumber);
        }

        client = this.createClient();
        await this.connectOrRelease(client);

        const result = await withTimeout(
          client.sendCode({ apiId: this.config.apiId, apiHash: this.config.apiHash }, phoneNumber),
          EXTERNAL_CALL_TIMEOUT_MS,
          'Send code',
        );

        // Сохраняем состояние для следующего запроса
        const createdAt = Date.now();
        await this.releaseReplacedAuthState(phoneNumber, client);
        this.authStates.set(phoneNumber, {
          client: client!,
          phoneCodeHash: result.phoneCodeHash,
          phoneNumber,
          createdAt,
        });
        this.saveAuthState(phoneNumber, result.phoneCodeHash, createdAt);
        this.logger.log('Auth: code sent');

        return {
          needsCode: true,
          message: 'Phone code has been sent to your phone. Please provide the code.',
        };
      }

      // Шаг 2: Проверка кода
      let authState = this.authStates.get(phoneNumber);
      if (!authState) {
        const persisted = this.loadAuthStates();
        const saved = persisted.get(phoneNumber);
        if (saved) {
          const restoredClient = this.createClient();
          await this.connectOrRelease(restoredClient);
          authState = {
            client: restoredClient,
            phoneCodeHash: saved.phoneCodeHash,
            phoneNumber,
            createdAt: saved.createdAt,
          };
          await this.releaseReplacedAuthState(phoneNumber, restoredClient);
          this.authStates.set(phoneNumber, authState);
          this.logger.debug('Auth: pending state restored from file');
        }
      }
      if (!authState) {
        throw new BadRequestException(CODE_NOT_REQUESTED_MESSAGE);
      }

      try {
        await withTimeout(
          authState.client.invoke(
            new Api.auth.SignIn({
              phoneNumber: phoneNumber,
              phoneCodeHash: authState.phoneCodeHash,
              phoneCode: phoneCode,
            }),
          ),
          EXTERNAL_CALL_TIMEOUT_MS,
          'Sign in',
        );

        // Успешная авторизация
        const sessionString = (authState.client.session as StringSession).save();

        // Сохраняем клиента под session string
        await this.clients.set(sessionString, authState.client);
        this.authStates.delete(phoneNumber);
        this.saveSession(sessionString);
        this.deleteAuthState(phoneNumber);
        this.logger.log('Auth: authenticated');

        return {
          sessionString,
          message: 'Successfully authenticated',
        };
      } catch (error: any) {
        // Нужен 2FA пароль
        if (error.message.includes('SESSION_PASSWORD_NEEDED')) {
          if (!password) {
            this.logger.log('Auth: 2FA password required');
            return {
              needsPassword: true,
              message: '2FA password is required.',
            };
          }

          // Шаг 3: Проверка 2FA пароля
          const passwordInfo = await withTimeout(
            authState.client.invoke(new Api.account.GetPassword()),
            EXTERNAL_CALL_TIMEOUT_MS,
            'Get password',
          );

          // Вычисляем SRP hash для пароля
          const passwordSrp = await computeCheck(passwordInfo, password);

          await withTimeout(
            authState.client.invoke(new Api.auth.CheckPassword({ password: passwordSrp })),
            EXTERNAL_CALL_TIMEOUT_MS,
            'Check password',
          );

          const sessionString = (authState.client.session as StringSession).save();

          // Сохраняем клиента под session string
          await this.clients.set(sessionString, authState.client);
          this.authStates.delete(phoneNumber);
          this.saveSession(sessionString);
          this.deleteAuthState(phoneNumber);
          this.logger.log('Auth: authenticated with 2FA');

          return {
            sessionString,
            message: 'Successfully authenticated',
          };
        } else {
          throw error;
        }
      }
    } catch (error: unknown) {
      // Очистка состояния при ошибке
      const authState = this.authStates.get(phoneNumber);
      if (authState) {
        await releaseClient(authState.client);
        this.authStates.delete(phoneNumber);
        this.deleteAuthState(phoneNumber);
      }

      // Очистка клиента, если он был создан, но не сохранен
      if (client && client !== authState?.client) {
        await releaseClient(client);
      }

      throw this.failWith('Auth', error);
    }
  }

  /**
   * Получает клиента из кэша
   * ВАЖНО: Клиент должен быть создан через authenticate() перед использованием
   */
  private async getClient(sessionString: string): Promise<TelegramClient> {
    // Очищаем от пробелов/переносов
    const cleanSession = sessionString.trim();

    const cached = this.clients.get(cleanSession);
    if (cached) {
      return cached;
    }

    // Попытка восстановить клиента из файла
    const persisted = this.loadSessions();
    if (persisted.has(cleanSession)) {
      const restoredClient = this.createClient(cleanSession);
      await this.connectOrRelease(restoredClient);
      await this.clients.set(cleanSession, restoredClient);
      return restoredClient;
    }

    throw invalidSessionException();
  }

  /** Returns the cached client for the session, reconnecting it when the socket dropped. */
  private async getConnectedClient(sessionString: string): Promise<TelegramClient> {
    const client = await this.getClient(sessionString);
    if (!client.connected) {
      await withTimeout(client.connect(), EXTERNAL_CALL_TIMEOUT_MS, CONNECTION_LABEL);
    }
    return client;
  }

  /** Drops a cached client once Telegram has rejected its session for good. */
  private async evictIfSessionInvalid(sessionString: string, error: unknown): Promise<void> {
    if (isInvalidSessionError(error)) {
      const cleanSession = sessionString.trim();
      await this.clients.evict(cleanSession);
      // Without this, a revoked session would be restored from the file and reconnected on every call.
      this.deleteSession(cleanSession);
    }
  }

  /**
   * Returns posts of a channel inside the last `hoursBack` hours.
   * The walk is paged and capped at POSTS_MAX_MESSAGES; `isTruncated` tells the caller
   * that older posts inside the window were not returned.
   */
  async getChannelPosts(
    channelUsername: string,
    sessionString: string,
    hoursBack: number = HOURS_BACK_DEFAULT,
  ): Promise<GetPostsResponse> {
    try {
      const client = await this.getConnectedClient(sessionString);
      const windowStart = Math.floor(Date.now() / MS_IN_SECOND) - hoursBack * SECONDS_IN_HOUR;
      const { messages, isTruncated } = await this.walkChannel(
        client,
        channelUsername,
        windowStart,
      );
      const posts = messages.map((message) => this.parseMessage(message, channelUsername));
      this.logger.log(
        `Posts: @${channelUsername} ${hoursBack}h -> ${posts.length} posts, truncated=${isTruncated}`,
      );

      return { posts, count: posts.length, isTruncated };
    } catch (error: unknown) {
      await this.evictIfSessionInvalid(sessionString, error);
      throw this.failWith(`Posts: @${channelUsername}`, error);
    }
  }

  /**
   * Walks the channel newest-first, page by page, until a message leaves the window,
   * the history ends, or POSTS_MAX_MESSAGES is reached.
   */
  private async walkChannel(
    client: TelegramClient,
    channelUsername: string,
    windowStart: number,
  ): Promise<{ messages: Api.Message[]; isTruncated: boolean }> {
    const channel = await withTimeout(
      client.getInputEntity(channelUsername),
      EXTERNAL_CALL_TIMEOUT_MS,
      'Resolve channel',
    );
    const messages: Api.Message[] = [];
    let walked = 0;
    let offsetId = 0;

    while (walked < POSTS_MAX_MESSAGES) {
      const limit = Math.min(POSTS_PAGE_SIZE, POSTS_MAX_MESSAGES - walked);
      const page = await this.fetchPage(client, channel, { limit, offsetId });
      walked += page.length;
      messages.push(...page.filter((item) => isPostInWindow(item, windowStart)));
      if (page.length < limit || page.some((item) => isOlderThan(item, windowStart))) {
        return { messages, isTruncated: false };
      }
      offsetId = page[page.length - 1].id;
    }

    return {
      messages,
      isTruncated: await this.hasOlderInWindow(client, channel, offsetId, windowStart),
    };
  }

  /** Probes one message past the ceiling so a window that ends exactly there is not flagged. */
  private async hasOlderInWindow(
    client: TelegramClient,
    channel: Api.TypeInputPeer,
    offsetId: number,
    windowStart: number,
  ): Promise<boolean> {
    const [next] = await this.fetchPage(client, channel, { limit: 1, offsetId });
    return next !== undefined && !isOlderThan(next, windowStart);
  }

  private async fetchPage(
    client: TelegramClient,
    channel: Api.TypeInputPeer,
    page: { limit: number; offsetId: number },
  ): Promise<Api.TypeMessage[]> {
    const result = await withTimeout(
      client.getMessages(channel, page),
      EXTERNAL_CALL_TIMEOUT_MS,
      'Get messages',
    );
    return [...result];
  }

  /**
   * Парсит сообщение в формат TelegramPost
   */
  private parseMessage(message: Api.Message, channelUsername: string): TelegramPost {
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
      date: new Date(message.date * MS_IN_SECOND),
      media,
      postUrl,
    };
  }

  /**
   * Reports whether the session is usable: `failed` means the session itself is unknown or
   * rejected by Telegram. A transport failure or flood wait is not a verdict on the session
   * and is thrown as the mapped HTTP exception instead.
   */
  async checkSession(sessionString: string): Promise<{ status: 'success' | 'failed' }> {
    try {
      const client = await this.getConnectedClient(sessionString);
      await withTimeout(
        client.invoke(new Api.users.GetUsers({ id: [new Api.InputUserSelf()] })),
        EXTERNAL_CALL_TIMEOUT_MS,
        'Get self',
      );
      this.logger.log('Session check: success');
      return { status: 'success' };
    } catch (error: unknown) {
      if (!isInvalidSessionError(error)) {
        throw this.failWith('Session check', error);
      }
      await this.evictIfSessionInvalid(sessionString, error);
      this.logger.log(`Session check: failed (${describeError(error)})`);
      return { status: 'failed' };
    }
  }

  /**
   * Maps a failure to its HTTP exception and writes the single outcome line for the request:
   * the operation, the status and a caller-safe error description, never the request payload.
   */
  private failWith(operation: string, error: unknown): HttpException {
    const exception = toHttpException(error);
    const line = `${operation} failed: ${exception.getStatus()} (${describeError(error)})`;
    if (exception.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(line);
    } else {
      this.logger.warn(line);
    }
    return exception;
  }

  /**
   * Отключает клиента
   */
  async disconnect(sessionString: string): Promise<void> {
    await this.clients.evict(sessionString);
    this.deleteSession(sessionString);
  }

  private ensureDataDir(): void {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
    } catch (error: unknown) {
      this.logger.error(`Failed to create data directory: ${describeError(error)}`);
    }
  }

  private loadAuthStates(): Map<string, { phoneCodeHash: string; createdAt: number }> {
    try {
      if (!fs.existsSync(this.authStatesFile)) return new Map();
      const parsed = JSON.parse(fs.readFileSync(this.authStatesFile, 'utf-8'));
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  private saveAuthState(phoneNumber: string, phoneCodeHash: string, createdAt: number): void {
    try {
      const existing = this.loadAuthStates();
      existing.set(phoneNumber, { phoneCodeHash, createdAt });
      fs.writeFileSync(this.authStatesFile, JSON.stringify(Object.fromEntries(existing), null, 2));
    } catch (error: unknown) {
      this.logger.error(`Failed to save auth state: ${describeError(error)}`);
    }
  }

  private deleteAuthState(phoneNumber: string): void {
    try {
      const existing = this.loadAuthStates();
      existing.delete(phoneNumber);
      fs.writeFileSync(this.authStatesFile, JSON.stringify(Object.fromEntries(existing), null, 2));
    } catch (error: unknown) {
      this.logger.error(`Failed to delete auth state: ${describeError(error)}`);
    }
  }

  private loadSessions(): Set<string> {
    try {
      if (!fs.existsSync(this.sessionsFile)) return new Set();
      return new Set(JSON.parse(fs.readFileSync(this.sessionsFile, 'utf-8')) as string[]);
    } catch {
      return new Set();
    }
  }

  private saveSession(sessionString: string): void {
    try {
      const existing = this.loadSessions();
      existing.add(sessionString);
      fs.writeFileSync(this.sessionsFile, JSON.stringify(Array.from(existing), null, 2));
    } catch (error: unknown) {
      this.logger.error(`Failed to save session: ${describeError(error)}`);
    }
  }

  private deleteSession(sessionString: string): void {
    try {
      const existing = this.loadSessions();
      existing.delete(sessionString);
      fs.writeFileSync(this.sessionsFile, JSON.stringify(Array.from(existing), null, 2));
    } catch (error: unknown) {
      this.logger.error(`Failed to delete session: ${describeError(error)}`);
    }
  }
}

/** A regular post (not a service message) dated inside the window. */
function isPostInWindow(item: Api.TypeMessage, windowStart: number): item is Api.Message {
  return item instanceof Api.Message && item.date >= windowStart;
}

/** True when the item is dated before the window; undated items never end the walk. */
function isOlderThan(item: Api.TypeMessage, windowStart: number): boolean {
  return 'date' in item && typeof item.date === 'number' && item.date < windowStart;
}

/** Tears a client down for good; `destroy` also stops the GramJS update loop that would reconnect. */
async function releaseClient(client: TelegramClient): Promise<void> {
  try {
    await client.destroy();
  } catch {
    // The client is being dropped either way; a failed teardown leaves nothing to retry.
  }
}
