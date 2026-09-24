import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { API_KEYS_ENV_VAR } from '../src/config/api-keys.config';
import { API_KEY_HEADER, SESSION_HEADER } from '../src/shared/constants/http.constants';
import { configureHttpPipeline } from '../src/shared/utils/http-pipeline';
import { TelegramService } from '../src/telegram/telegram.service';
import { TELEGRAM_UNAVAILABLE_MESSAGE } from '../src/telegram/utils/telegram-errors';
import { closeLifecycleProviders } from './lifecycle-providers';

const HEALTH_ROUTE = '/telegram/health';
const ME_ROUTE = '/telegram/me';
const ROOT_ROUTE = '/';
const LEGACY_HEALTH_ROUTE = '/health';
const EXPECTED_HEALTH_BODY = { status: 'ok' };

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVICE_UNAVAILABLE = 503;

const INPUT_FAKE_API_KEY = 'fake-e2e-api-key';
const INPUT_FAKE_SESSION_STRING = 'fake-session-string';

const RAILWAY_CONFIG_FILE = join(__dirname, '..', 'railway.toml');
const HEALTHCHECK_PATH_PATTERN = /^\s*healthcheck_path\s*=\s*"([^"]+)"/m;

const TELEGRAM_ENV_VARS = ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH'] as const;

/**
 * Replaces the TelegramService facade. The real lifecycle providers behind it are still built,
 * but none of them creates a client unless the facade calls it, so nothing touches Telegram.
 */
const mockTelegramService = {
  authenticate: jest.fn(),
  checkSession: jest.fn(),
  getChannelPosts: jest.fn(),
};

function deleteTelegramEnvVars(): void {
  for (const envVar of TELEGRAM_ENV_VARS) {
    delete process.env[envVar];
  }
}

function readConfiguredHealthcheckPath(): string {
  const railwayConfig = readFileSync(RAILWAY_CONFIG_FILE, 'utf8');
  const matchedPath = HEALTHCHECK_PATH_PATTERN.exec(railwayConfig);

  return matchedPath ? matchedPath[1] : '';
}

describe('health probe (e2e)', () => {
  const originalEnvValues = new Map<string, string | undefined>();
  let app: NestExpressApplication;

  beforeAll(async () => {
    for (const envVar of TELEGRAM_ENV_VARS) {
      originalEnvValues.set(envVar, process.env[envVar]);
    }
    originalEnvValues.set(API_KEYS_ENV_VAR, process.env[API_KEYS_ENV_VAR]);
    deleteTelegramEnvVars();
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

    for (const [envVar, originalValue] of originalEnvValues) {
      if (originalValue === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = originalValue;
      }
    }
  });

  beforeEach(() => {
    // ConfigModule reads the local .env during bootstrap, so restate the variables again.
    deleteTelegramEnvVars();
    process.env[API_KEYS_ENV_VAR] = INPUT_FAKE_API_KEY;

    for (const mockMethod of Object.values(mockTelegramService)) {
      mockMethod.mockReset();
    }
  });

  it('answers the health route with a constant payload while the Telegram variables are absent', async () => {
    expect(process.env.TELEGRAM_API_ID).toBeUndefined();
    expect(process.env.TELEGRAM_API_HASH).toBeUndefined();

    const actualResponse = await request(app.getHttpServer()).get(HEALTH_ROUTE);

    expect(actualResponse.status).toBe(HTTP_OK);
    expect(actualResponse.body).toEqual(EXPECTED_HEALTH_BODY);
  });

  it('serves the health route at the path configured as the platform healthcheck', async () => {
    const expectedHealthcheckPath = readConfiguredHealthcheckPath();

    const actualResponse = await request(app.getHttpServer()).get(expectedHealthcheckPath);

    expect(expectedHealthcheckPath).toBe(HEALTH_ROUTE);
    expect(actualResponse.status).toBe(HTTP_OK);
    expect(actualResponse.body).toEqual(EXPECTED_HEALTH_BODY);
  });

  it('exposes no duplicate probe on the root route', async () => {
    const actualResponse = await request(app.getHttpServer()).get(ROOT_ROUTE);

    expect(actualResponse.status).toBe(HTTP_NOT_FOUND);
  });

  it('exposes no duplicate probe on the bare health route', async () => {
    const actualResponse = await request(app.getHttpServer()).get(LEGACY_HEALTH_ROUTE);

    expect(actualResponse.status).toBe(HTTP_NOT_FOUND);
  });

  it('never calls the Telegram service while answering the health route', async () => {
    const actualResponse = await request(app.getHttpServer()).get(HEALTH_ROUTE);

    expect(actualResponse.status).toBe(HTTP_OK);
    for (const mockMethod of Object.values(mockTelegramService)) {
      expect(mockMethod).not.toHaveBeenCalled();
    }
  });

  it('answers the health route without a caller key while a caller key is configured', async () => {
    expect(process.env[API_KEYS_ENV_VAR]).toBe(INPUT_FAKE_API_KEY);

    const actualResponse = await request(app.getHttpServer()).get(HEALTH_ROUTE);

    expect(actualResponse.status).toBe(HTTP_OK);
    expect(actualResponse.body).toEqual(EXPECTED_HEALTH_BODY);
  });

  it('rejects an authenticated route carrying no caller key before the service is called', async () => {
    const actualResponse = await request(app.getHttpServer())
      .get(ME_ROUTE)
      .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

    expect(actualResponse.status).toBe(HTTP_UNAUTHORIZED);
    expect(mockTelegramService.checkSession).not.toHaveBeenCalled();
  });

  it('lets an authenticated route through once the caller key is present', async () => {
    const expectedBody = { status: 'success' };
    mockTelegramService.checkSession.mockResolvedValue(expectedBody);

    const actualResponse = await request(app.getHttpServer())
      .get(ME_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

    expect(actualResponse.status).toBe(HTTP_OK);
    expect(actualResponse.body).toEqual(expectedBody);
    expect(mockTelegramService.checkSession).toHaveBeenCalledWith(INPUT_FAKE_SESSION_STRING);
  });

  it('propagates a Telegram outage from the session check as 503', async () => {
    // Arrange
    mockTelegramService.checkSession.mockRejectedValue(
      new ServiceUnavailableException(TELEGRAM_UNAVAILABLE_MESSAGE),
    );

    // Act
    const actualResponse = await request(app.getHttpServer())
      .get(ME_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

    // Assert
    expect(actualResponse.status).toBe(HTTP_SERVICE_UNAVAILABLE);
    expect(actualResponse.body.message).toBe(TELEGRAM_UNAVAILABLE_MESSAGE);
    expect(actualResponse.body).not.toEqual({ status: 'failed' });
  });

  it('reports a failed session when the session header is absent', async () => {
    const actualResponse = await request(app.getHttpServer())
      .get(ME_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY);

    expect(actualResponse.status).toBe(HTTP_OK);
    expect(actualResponse.body).toEqual({ status: 'failed' });
    expect(mockTelegramService.checkSession).not.toHaveBeenCalled();
  });

  it('ignores a credential offered in the query string, which no longer authorizes the route', async () => {
    const actualResponse = await request(app.getHttpServer())
      .get(ME_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .query({ sessionString: INPUT_FAKE_SESSION_STRING });

    expect(actualResponse.body).toEqual({ status: 'failed' });
    expect(mockTelegramService.checkSession).not.toHaveBeenCalled();
  });
});
