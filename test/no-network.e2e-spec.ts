import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import Redis from 'ioredis';
import { TelegramClient } from 'telegram';
import { AlertService } from '../src/alerts/alert.service';
import { AppModule } from '../src/app.module';
import { API_KEYS_ENV_VAR } from '../src/config/api-keys.config';
import { API_KEY_HEADER, SESSION_HEADER } from '../src/shared/constants/http.constants';
import { REDIS_CLIENT, SESSION_PERSISTENCE_CONFIG } from '../src/redis/redis.constants';
import { configureHttpPipeline } from '../src/shared/utils/http-pipeline';
import { AuthService } from '../src/telegram/auth.service';
import { ChannelService } from '../src/telegram/channel.service';
import { SessionStore } from '../src/telegram/session-store';
import { TelegramClientFactory } from '../src/telegram/telegram-client.factory';
import { TelegramService } from '../src/telegram/telegram.service';
import { closeLifecycleProviders } from './lifecycle-providers';

/**
 * Replaces only the client constructor with a spy, so any code path that tried to open
 * an MTProto connection during the run would be recorded instead of reaching Telegram.
 */
jest.mock('telegram', () => ({
  ...jest.requireActual<Record<string, unknown>>('telegram'),
  TelegramClient: jest.fn(),
}));

/** A spy constructor: a Redis connection attempted during the run would be recorded here. */
jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn() }));

const AUTH_ROUTE = '/telegram/auth';
const HEALTH_ROUTE = '/telegram/health';
const ME_ROUTE = '/telegram/me';
const POSTS_ROUTE = '/telegram/channel/fakechannel/posts';

const HTTP_OK = 200;
const EXPECTED_AUTH_CALL_COUNT = 2;
/** One idle sweep in SessionStore, one auth-state sweep in AuthService. */
const EXPECTED_SWEEP_COUNT = 2;

const INPUT_FAKE_API_KEY = 'fake-e2e-api-key';
const INPUT_FAKE_PHONE_NUMBER = '+10000000021';
const INPUT_FAKE_PHONE_CODE = '00000';
const INPUT_FAKE_SESSION_STRING = 'fake-e2e-session-string';
/** Event-loop turns given to a background alert send before asserting it never happened. */
const ALERT_SETTLE_TURNS = 10;

/**
 * Replaces the TelegramService facade. The real lifecycle providers behind it are still built,
 * but none of them creates a client unless the facade calls it, so nothing touches Telegram.
 */
const mockTelegramService = {
  authenticate: jest.fn(),
  checkSession: jest.fn(),
  getChannelPosts: jest.fn(),
};

describe('no-network guarantee (e2e)', () => {
  const mockTelegramClientConstructor = TelegramClient as unknown as jest.Mock;
  let app: NestExpressApplication;
  let originalApiKeys: string | undefined;
  let mockFetch: jest.SpyInstance;

  beforeAll(async () => {
    // Every outbound HTTP call of the service (alerts included) goes through global fetch.
    mockFetch = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('fake: no network in the no-network e2e run'));
    originalApiKeys = process.env[API_KEYS_ENV_VAR];
    process.env[API_KEYS_ENV_VAR] = INPUT_FAKE_API_KEY;

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TelegramService)
      .useValue(mockTelegramService)
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
      bodyParser: false,
    });
    configureHttpPipeline(app);
    await app.init();
  });

  afterAll(async () => {
    await closeLifecycleProviders(app);
    await app.close();
    mockFetch.mockRestore();

    if (originalApiKeys === undefined) {
      delete process.env[API_KEYS_ENV_VAR];
    } else {
      process.env[API_KEYS_ENV_VAR] = originalApiKeys;
    }
  });

  beforeEach(() => {
    // ConfigModule reads the local .env during bootstrap, so restate the fake key.
    process.env[API_KEYS_ENV_VAR] = INPUT_FAKE_API_KEY;

    for (const mockMethod of Object.values(mockTelegramService)) {
      mockMethod.mockReset();
    }
    mockTelegramService.authenticate.mockResolvedValue({ needsCode: true, message: 'fake' });
    mockTelegramService.checkSession.mockResolvedValue({ status: 'success' });
    mockTelegramService.getChannelPosts.mockResolvedValue({
      posts: [],
      count: 0,
      isTruncated: false,
    });
  });

  it('resolves the Telegram service to the mock provider, not the real implementation', () => {
    const actualService = app.get(TelegramService);

    expect(actualService).toBe(mockTelegramService);
    expect(actualService).not.toBeInstanceOf(TelegramService);
  });

  it('constructs no GramJS client while serving every route', async () => {
    // Arrange
    const server = app.getHttpServer();

    // Act
    const actualResponses = [
      await request(server).get(HEALTH_ROUTE),
      await request(server)
        .post(AUTH_ROUTE)
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .send({ phoneNumber: INPUT_FAKE_PHONE_NUMBER }),
      await request(server)
        .post(AUTH_ROUTE)
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .send({ phoneNumber: INPUT_FAKE_PHONE_NUMBER, phoneCode: INPUT_FAKE_PHONE_CODE }),
      await request(server)
        .get(ME_ROUTE)
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING),
      await request(server)
        .get(POSTS_ROUTE)
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING),
    ];

    // Assert
    for (const actualResponse of actualResponses) {
      expect(actualResponse.status).toBe(HTTP_OK);
    }
    expect(mockTelegramService.authenticate).toHaveBeenCalledTimes(EXPECTED_AUTH_CALL_COUNT);
    expect(mockTelegramService.checkSession).toHaveBeenCalledTimes(1);
    expect(mockTelegramService.getChannelPosts).toHaveBeenCalledTimes(1);
    expect(jest.isMockFunction(mockTelegramClientConstructor)).toBe(true);
    expect(mockTelegramClientConstructor).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('boots with alerts disabled: an alert raised during the run never reaches the network', async () => {
    // Arrange
    const actualAlerts = app.get(AlertService);

    // Act
    actualAlerts.info('fake e2e info');
    actualAlerts.warning('fake e2e warning');
    actualAlerts.error('fake e2e error');
    for (let turn = 0; turn < ALERT_SETTLE_TURNS; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Assert
    expect(process.env.ALERTS_URL).toBe('');
    expect(process.env.ALERTS_API_KEY).toBe('');
    expect(actualAlerts).toBeInstanceOf(AlertService);
    expect(jest.isMockFunction(global.fetch)).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('builds the real lifecycle providers behind the mock without constructing a GramJS client', () => {
    // Act
    const actualProviders = [
      app.get(TelegramClientFactory),
      app.get(SessionStore),
      app.get(AuthService),
      app.get(ChannelService),
    ];

    // Assert
    expect(actualProviders[0]).toBeInstanceOf(TelegramClientFactory);
    expect(actualProviders[1]).toBeInstanceOf(SessionStore);
    expect(actualProviders[2]).toBeInstanceOf(AuthService);
    expect(actualProviders[3]).toBeInstanceOf(ChannelService);
    expect(jest.isMockFunction(mockTelegramClientConstructor)).toBe(true);
    expect(mockTelegramClientConstructor).not.toHaveBeenCalled();
  });

  it('boots in memory-only session mode and never constructs a Redis client, even with a local .env', () => {
    // Arrange
    const mockRedisConstructor = Redis as unknown as jest.Mock;

    // Act
    const actualRedisClient = app.get(REDIS_CLIENT);
    const actualPersistenceConfig = app.get(SESSION_PERSISTENCE_CONFIG);

    // Assert
    expect(process.env.REDIS_URL).toBe('');
    expect(actualRedisClient).toBeNull();
    expect(actualPersistenceConfig).toBeNull();
    expect(jest.isMockFunction(mockRedisConstructor)).toBe(true);
    expect(mockRedisConstructor).not.toHaveBeenCalled();
  });

  it('leaves no background sweep running once the lifecycle providers are closed', async () => {
    // Arrange
    const mockClearInterval = jest.spyOn(global, 'clearInterval');

    try {
      // Act
      await closeLifecycleProviders(app);

      // Assert
      expect(mockClearInterval).toHaveBeenCalledTimes(EXPECTED_SWEEP_COUNT);
      expect(mockTelegramClientConstructor).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    } finally {
      mockClearInterval.mockRestore();
    }
  });
});
