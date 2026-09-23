import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { TelegramClient } from 'telegram';
import { AppModule } from '../src/app.module';
import { API_KEYS_ENV_VAR } from '../src/config/api-keys.config';
import { API_KEY_HEADER, SESSION_HEADER } from '../src/shared/constants/http.constants';
import { configureHttpPipeline } from '../src/shared/utils/http-pipeline';
import { TelegramService } from '../src/telegram/telegram.service';

/**
 * Replaces only the client constructor with a spy, so any code path that tried to open
 * an MTProto connection during the run would be recorded instead of reaching Telegram.
 */
jest.mock('telegram', () => ({
  ...jest.requireActual<Record<string, unknown>>('telegram'),
  TelegramClient: jest.fn(),
}));

const AUTH_ROUTE = '/telegram/auth';
const HEALTH_ROUTE = '/telegram/health';
const ME_ROUTE = '/telegram/me';
const POSTS_ROUTE = '/telegram/channel/fakechannel/posts';

const HTTP_OK = 200;
const EXPECTED_AUTH_CALL_COUNT = 2;

const INPUT_FAKE_API_KEY = 'fake-e2e-api-key';
const INPUT_FAKE_PHONE_NUMBER = '+10000000021';
const INPUT_FAKE_PHONE_CODE = '00000';
const INPUT_FAKE_SESSION_STRING = 'fake-e2e-session-string';

/** No real TelegramService is constructed, so nothing touches Telegram or the filesystem. */
const mockTelegramService = {
  authenticate: jest.fn(),
  checkSession: jest.fn(),
  getChannelPosts: jest.fn(),
  disconnect: jest.fn(),
};

describe('no-network guarantee (e2e)', () => {
  const mockTelegramClientConstructor = TelegramClient as unknown as jest.Mock;
  let app: NestExpressApplication;
  let originalApiKeys: string | undefined;

  beforeAll(async () => {
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
    await app.close();

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
  });
});
