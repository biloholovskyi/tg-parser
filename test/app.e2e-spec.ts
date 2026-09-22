import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureHttpPipeline } from '../src/shared/utils/http-pipeline';
import { TelegramService } from '../src/telegram/telegram.service';

const HEALTH_ROUTE = '/telegram/health';
const ROOT_ROUTE = '/';
const LEGACY_HEALTH_ROUTE = '/health';
const EXPECTED_HEALTH_BODY = { status: 'ok' };

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

const RAILWAY_CONFIG_FILE = join(__dirname, '..', 'railway.toml');
const HEALTHCHECK_PATH_PATTERN = /^\s*healthcheck_path\s*=\s*"([^"]+)"/m;

const TELEGRAM_ENV_VARS = ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH'] as const;

/** No real TelegramService is constructed, so nothing touches Telegram or the filesystem. */
const mockTelegramService = {
  authenticate: jest.fn(),
  checkSession: jest.fn(),
  getChannelPosts: jest.fn(),
  disconnect: jest.fn(),
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
    deleteTelegramEnvVars();

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

    for (const [envVar, originalValue] of originalEnvValues) {
      if (originalValue === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = originalValue;
      }
    }
  });

  beforeEach(() => {
    // ConfigModule reads the local .env during bootstrap, so clear the variables again.
    deleteTelegramEnvVars();

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
});
