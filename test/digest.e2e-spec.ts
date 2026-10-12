import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { API_KEYS_ENV_VAR } from '../src/config/api-keys.config';
import {
  DIGEST_CHANNELS_ENV_VAR,
  GROK_API_KEY_ENV_VAR,
  TELEGRAM_BOT_CHAT_ID_ENV_VAR,
  TELEGRAM_BOT_TOKEN_ENV_VAR,
} from '../src/config/digest.config';
import {
  DIGEST_ALREADY_RUNNING_MESSAGE,
  DIGEST_NOT_CONFIGURED_MESSAGE,
  DigestService,
} from '../src/digest/digest.service';
import { DIGEST_JOB_NAME } from '../src/digest/constants';
import { API_KEY_HEADER, SESSION_HEADER } from '../src/shared/constants/http.constants';
import { configureHttpPipeline } from '../src/shared/utils/http-pipeline';
import { MISSING_SESSION_MESSAGE } from '../src/shared/utils/session-header';
import { TelegramService } from '../src/telegram/telegram.service';
import { INVALID_SESSION_MESSAGE } from '../src/telegram/utils/telegram-errors';
import { closeLifecycleProviders } from './lifecycle-providers';

const DIGEST_SESSION_ROUTE = '/digest/session';
const DIGEST_RUN_ROUTE = '/digest/run';

/** Blanked, not deleted: ConfigModule never refills a defined variable from the local .env. */
const DIGEST_REQUIRED_ENV_VARS = [
  DIGEST_CHANNELS_ENV_VAR,
  GROK_API_KEY_ENV_VAR,
  TELEGRAM_BOT_TOKEN_ENV_VAR,
  TELEGRAM_BOT_CHAT_ID_ENV_VAR,
];

const HTTP_ACCEPTED = 202;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_CONFLICT = 409;
const HTTP_SERVICE_UNAVAILABLE = 503;

const INPUT_FAKE_API_KEY = 'fake-e2e-api-key';
const INPUT_UNKNOWN_API_KEY = 'fake-e2e-api-nil';
const INPUT_FAKE_SESSION_STRING = 'fake-e2e-digest-session';
const INPUT_UNKNOWN_SESSION_STRING = 'fake-e2e-unknown-session';

/**
 * Replaces the TelegramService facade. The real lifecycle providers behind it are still built,
 * but none of them creates a client unless the facade calls it, so nothing touches Telegram.
 */
const mockTelegramService = {
  authenticate: jest.fn(),
  checkSession: jest.fn(),
  getChannelPosts: jest.fn(),
  markDigestSession: jest.fn(),
  readPostsAsDigestAccount: jest.fn(),
};

const originalDigestEnv = new Map(
  DIGEST_REQUIRED_ENV_VARS.map((name) => [name, process.env[name]] as const),
);

beforeAll(() => {
  for (const name of DIGEST_REQUIRED_ENV_VARS) {
    process.env[name] = '';
  }
});

afterAll(() => {
  for (const [name, value] of originalDigestEnv) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

/** Boots AppModule with the facade mocked and, when given, the digest service replaced. */
async function createApp(digestService?: object): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TelegramService)
    .useValue(mockTelegramService);
  if (digestService) {
    builder = builder.overrideProvider(DigestService).useValue(digestService);
  }
  const moduleRef: TestingModule = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  configureHttpPipeline(app);
  await app.init();
  return app;
}

describe('PUT /digest/session (e2e)', () => {
  let app: NestExpressApplication;
  let originalApiKeys: string | undefined;

  beforeAll(async () => {
    originalApiKeys = process.env[API_KEYS_ENV_VAR];
    process.env[API_KEYS_ENV_VAR] = INPUT_FAKE_API_KEY;
    app = await createApp();
  });

  afterAll(async () => {
    await closeLifecycleProviders(app);
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
    mockTelegramService.markDigestSession.mockImplementation(async (sessionString: string) => {
      if (sessionString !== INPUT_FAKE_SESSION_STRING) {
        throw new UnauthorizedException(INVALID_SESSION_MESSAGE);
      }
    });
  });

  it('rejects a caller without x-api-key with 401 before reaching the facade', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer())
      .put(DIGEST_SESSION_ROUTE)
      .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

    // Assert
    expect(actualResponse.status).toBe(HTTP_UNAUTHORIZED);
    expect(mockTelegramService.markDigestSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown x-api-key with 401 before reaching the facade', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer())
      .put(DIGEST_SESSION_ROUTE)
      .set(API_KEY_HEADER, INPUT_UNKNOWN_API_KEY)
      .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

    // Assert
    expect(actualResponse.status).toBe(HTTP_UNAUTHORIZED);
    expect(mockTelegramService.markDigestSession).not.toHaveBeenCalled();
  });

  it('answers 400 with the missing-session message when the session header is absent', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer())
      .put(DIGEST_SESSION_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY);

    // Assert
    expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
    expect(actualResponse.body.message).toBe(MISSING_SESSION_MESSAGE);
    expect(mockTelegramService.markDigestSession).not.toHaveBeenCalled();
  });

  it('answers 400 when the session header is whitespace only', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer())
      .put(DIGEST_SESSION_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .set(SESSION_HEADER, '   ');

    // Assert
    expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
    expect(mockTelegramService.markDigestSession).not.toHaveBeenCalled();
  });

  it('answers 401 for a session the facade does not know, without echoing it', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer())
      .put(DIGEST_SESSION_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .set(SESSION_HEADER, INPUT_UNKNOWN_SESSION_STRING);

    // Assert
    expect(actualResponse.status).toBe(HTTP_UNAUTHORIZED);
    expect(actualResponse.body.message).toBe(INVALID_SESSION_MESSAGE);
    expect(JSON.stringify(actualResponse.body)).not.toContain(INPUT_UNKNOWN_SESSION_STRING);
    expect(mockTelegramService.markDigestSession).toHaveBeenCalledWith(
      INPUT_UNKNOWN_SESSION_STRING,
    );
  });

  it('answers 204 with no body for a known session and passes it to the facade', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer())
      .put(DIGEST_SESSION_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

    // Assert
    expect(actualResponse.status).toBe(HTTP_NO_CONTENT);
    expect(actualResponse.text).toBe('');
    expect(mockTelegramService.markDigestSession).toHaveBeenCalledTimes(1);
    expect(mockTelegramService.markDigestSession).toHaveBeenCalledWith(INPUT_FAKE_SESSION_STRING);
  });

  it('never accepts the session in the query string', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer())
      .put(`${DIGEST_SESSION_ROUTE}?sessionString=${INPUT_FAKE_SESSION_STRING}`)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY);

    // Assert
    expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
    expect(mockTelegramService.markDigestSession).not.toHaveBeenCalled();
  });
});

describe('POST /digest/run (e2e, digest not configured)', () => {
  let app: NestExpressApplication;
  let originalApiKeys: string | undefined;

  beforeAll(async () => {
    originalApiKeys = process.env[API_KEYS_ENV_VAR];
    process.env[API_KEYS_ENV_VAR] = INPUT_FAKE_API_KEY;
    app = await createApp();
  });

  afterAll(async () => {
    await closeLifecycleProviders(app);
    await app.close();

    if (originalApiKeys === undefined) {
      delete process.env[API_KEYS_ENV_VAR];
    } else {
      process.env[API_KEYS_ENV_VAR] = originalApiKeys;
    }
  });

  beforeEach(() => {
    process.env[API_KEYS_ENV_VAR] = INPUT_FAKE_API_KEY;
  });

  it('rejects a caller without x-api-key with 401', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer()).post(DIGEST_RUN_ROUTE);

    // Assert
    expect(actualResponse.status).toBe(HTTP_UNAUTHORIZED);
  });

  it('answers 503 with the not-configured message', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer())
      .post(DIGEST_RUN_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY);

    // Assert
    expect(actualResponse.status).toBe(HTTP_SERVICE_UNAVAILABLE);
    expect(actualResponse.body.message).toBe(DIGEST_NOT_CONFIGURED_MESSAGE);
  });

  it('registers no scheduled job when the digest is not configured', () => {
    // Act
    const actualJobs = app.get(SchedulerRegistry).getCronJobs();

    // Assert
    expect(actualJobs.size).toBe(0);
  });

  it('leaves no job, interval or timeout in the scheduler after the application closes', async () => {
    // Arrange
    const inputApp = await createApp();
    const registry = inputApp.get(SchedulerRegistry);

    // Act
    await closeLifecycleProviders(inputApp);
    await inputApp.close();

    // Assert
    expect(registry.getCronJobs().size).toBe(0);
    expect(registry.getIntervals()).toEqual([]);
    expect(registry.getTimeouts()).toEqual([]);
  });
});

describe('POST /digest/run (e2e, digest service mocked)', () => {
  const mockDigestService = { start: jest.fn(), runScheduled: jest.fn() };
  let app: NestExpressApplication;
  let originalApiKeys: string | undefined;

  beforeAll(async () => {
    originalApiKeys = process.env[API_KEYS_ENV_VAR];
    process.env[API_KEYS_ENV_VAR] = INPUT_FAKE_API_KEY;
    app = await createApp(mockDigestService);
  });

  afterAll(async () => {
    await closeLifecycleProviders(app);
    await app.close();

    if (originalApiKeys === undefined) {
      delete process.env[API_KEYS_ENV_VAR];
    } else {
      process.env[API_KEYS_ENV_VAR] = originalApiKeys;
    }
  });

  beforeEach(() => {
    process.env[API_KEYS_ENV_VAR] = INPUT_FAKE_API_KEY;
    mockDigestService.start.mockReset();
    mockDigestService.start.mockReturnValue({ status: 'started' });
  });

  it('rejects a caller without x-api-key with 401 before reaching the service', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer()).post(DIGEST_RUN_ROUTE);

    // Assert
    expect(actualResponse.status).toBe(HTTP_UNAUTHORIZED);
    expect(mockDigestService.start).not.toHaveBeenCalled();
  });

  it('rejects an unknown x-api-key with 401 before reaching the service', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer())
      .post(DIGEST_RUN_ROUTE)
      .set(API_KEY_HEADER, INPUT_UNKNOWN_API_KEY);

    // Assert
    expect(actualResponse.status).toBe(HTTP_UNAUTHORIZED);
    expect(mockDigestService.start).not.toHaveBeenCalled();
  });

  it('answers 202 with the started body', async () => {
    // Act
    const actualResponse = await request(app.getHttpServer())
      .post(DIGEST_RUN_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY);

    // Assert
    expect(actualResponse.status).toBe(HTTP_ACCEPTED);
    expect(actualResponse.body).toEqual({ status: 'started' });
    expect(mockDigestService.start).toHaveBeenCalledTimes(1);
  });

  it('answers 409 when a run is already in progress', async () => {
    // Arrange
    mockDigestService.start.mockImplementation(() => {
      throw new ConflictException(DIGEST_ALREADY_RUNNING_MESSAGE);
    });

    // Act
    const actualResponse = await request(app.getHttpServer())
      .post(DIGEST_RUN_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY);

    // Assert
    expect(actualResponse.status).toBe(HTTP_CONFLICT);
    expect(actualResponse.body.message).toBe(DIGEST_ALREADY_RUNNING_MESSAGE);
  });

  it('registers no scheduled job, since the e2e environment leaves the digest unconfigured', () => {
    // Act
    const actualJobs = app.get(SchedulerRegistry).getCronJobs();

    // Assert
    expect(actualJobs.size).toBe(0);
  });
});

describe('digest schedule lifecycle (e2e, digest configured with fakes)', () => {
  const inputFakeDigestEnv: ReadonlyArray<readonly [string, string]> = [
    [DIGEST_CHANNELS_ENV_VAR, 'fake_channel'],
    [GROK_API_KEY_ENV_VAR, 'fake-grok-key'],
    [TELEGRAM_BOT_TOKEN_ENV_VAR, 'fake-bot-token'],
    [TELEGRAM_BOT_CHAT_ID_ENV_VAR, '-100000'],
  ];

  beforeEach(() => {
    for (const [name, value] of inputFakeDigestEnv) {
      process.env[name] = value;
    }
  });

  afterEach(() => {
    for (const name of DIGEST_REQUIRED_ENV_VARS) {
      process.env[name] = '';
    }
  });

  it('registers the daily job at boot and removes it when the application closes', async () => {
    // Arrange
    const inputApp = await createApp();
    const registry = inputApp.get(SchedulerRegistry);
    const actualJob = registry.getCronJob(DIGEST_JOB_NAME);
    const actualIsRunningAfterBoot = actualJob.running;

    // Act
    await closeLifecycleProviders(inputApp);
    await inputApp.close();

    // Assert
    expect(actualIsRunningAfterBoot).toBe(true);
    expect(actualJob.running).toBe(false);
    expect(registry.getCronJobs().size).toBe(0);
  });
});
