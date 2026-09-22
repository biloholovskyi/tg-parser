import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { REQUEST_BODY_MAX_BYTES } from '../src/shared/constants/http.constants';
import { configureHttpPipeline } from '../src/shared/utils/http-pipeline';
import { TelegramService } from '../src/telegram/telegram.service';

const AUTH_ROUTE = '/telegram/auth';
const HEALTH_ROUTE = '/telegram/health';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_PAYLOAD_TOO_LARGE = 413;

const INPUT_FAKE_PHONE_NUMBER = '+10000000000';
const INPUT_INVALID_PHONE_CODE = 'not-a-code';
const INPUT_FAKE_PHONE_CODE = '00000';
const INPUT_BLANK_VALUE = '   ';
const INPUT_PADDED_PASSWORD = '  fake-password  ';
const OVERSIZE_OVERSHOOT_BYTES = 2;
const CONTENT_TYPE_HEADER = 'Content-Type';
const CONTENT_TYPE_TEXT = 'text/plain';

const EXPECTED_STEP_ONE_RESPONSE = { needsCode: true, message: 'fake code sent' };

/** No real TelegramService is constructed, so nothing touches Telegram or the filesystem. */
const mockTelegramService = {
  authenticate: jest.fn(),
  checkSession: jest.fn(),
  getChannelPosts: jest.fn(),
  disconnect: jest.fn(),
};

describe('auth route perimeter (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
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
  });

  beforeEach(() => {
    for (const mockMethod of Object.values(mockTelegramService)) {
      mockMethod.mockReset();
    }
    mockTelegramService.authenticate.mockResolvedValue(EXPECTED_STEP_ONE_RESPONSE);
  });

  it('treats an empty phone code and password as absent and runs step one', async () => {
    const inputBody = { phoneNumber: INPUT_FAKE_PHONE_NUMBER, phoneCode: '', password: '' };

    const actualResponse = await request(app.getHttpServer()).post(AUTH_ROUTE).send(inputBody);

    expect(actualResponse.status).toBe(HTTP_OK);
    expect(actualResponse.body).toEqual(EXPECTED_STEP_ONE_RESPONSE);
    expect(mockTelegramService.authenticate).toHaveBeenCalledWith(
      INPUT_FAKE_PHONE_NUMBER,
      undefined,
      undefined,
    );
  });

  it('treats a whitespace-only phone code and password as absent and runs step one', async () => {
    const inputBody = {
      phoneNumber: INPUT_FAKE_PHONE_NUMBER,
      phoneCode: INPUT_BLANK_VALUE,
      password: INPUT_BLANK_VALUE,
    };

    const actualResponse = await request(app.getHttpServer()).post(AUTH_ROUTE).send(inputBody);

    expect(actualResponse.status).toBe(HTTP_OK);
    expect(mockTelegramService.authenticate).toHaveBeenCalledWith(
      INPUT_FAKE_PHONE_NUMBER,
      undefined,
      undefined,
    );
  });

  it('hands a padded password to the service verbatim', async () => {
    const inputBody = {
      phoneNumber: INPUT_FAKE_PHONE_NUMBER,
      phoneCode: INPUT_FAKE_PHONE_CODE,
      password: INPUT_PADDED_PASSWORD,
    };

    const actualResponse = await request(app.getHttpServer()).post(AUTH_ROUTE).send(inputBody);

    expect(actualResponse.status).toBe(HTTP_OK);
    expect(mockTelegramService.authenticate).toHaveBeenCalledWith(
      INPUT_FAKE_PHONE_NUMBER,
      INPUT_FAKE_PHONE_CODE,
      INPUT_PADDED_PASSWORD,
    );
  });

  it('rejects a whitespace-only phone number before the service is called', async () => {
    const inputBody = { phoneNumber: INPUT_BLANK_VALUE, phoneCode: '', password: '' };

    const actualResponse = await request(app.getHttpServer()).post(AUTH_ROUTE).send(inputBody);

    expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
    expect(mockTelegramService.authenticate).not.toHaveBeenCalled();
  });

  it('rejects a non-empty invalid phone code before the service is called', async () => {
    const inputBody = {
      phoneNumber: INPUT_FAKE_PHONE_NUMBER,
      phoneCode: INPUT_INVALID_PHONE_CODE,
      password: '',
    };

    const actualResponse = await request(app.getHttpServer()).post(AUTH_ROUTE).send(inputBody);

    expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
    expect(mockTelegramService.authenticate).not.toHaveBeenCalled();
  });

  it('rejects an empty phone number before the service is called', async () => {
    const inputBody = { phoneNumber: '', phoneCode: '', password: '' };

    const actualResponse = await request(app.getHttpServer()).post(AUTH_ROUTE).send(inputBody);

    expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
    expect(mockTelegramService.authenticate).not.toHaveBeenCalled();
  });

  it('rejects an oversized body of an unparsed content type on an unauthenticated route', async () => {
    const inputOversizedBody = 'f'.repeat(REQUEST_BODY_MAX_BYTES + OVERSIZE_OVERSHOOT_BYTES);

    const actualResponse = await request(app.getHttpServer())
      .get(HEALTH_ROUTE)
      .set(CONTENT_TYPE_HEADER, CONTENT_TYPE_TEXT)
      .send(inputOversizedBody);

    expect(actualResponse.status).toBe(HTTP_PAYLOAD_TOO_LARGE);
  });

  it('rejects an oversized auth body before the service is called', async () => {
    const inputOversizedBody = JSON.stringify({
      phoneNumber: INPUT_FAKE_PHONE_NUMBER,
      password: 'f'.repeat(REQUEST_BODY_MAX_BYTES),
    });

    const actualResponse = await request(app.getHttpServer())
      .post(AUTH_ROUTE)
      .send(inputOversizedBody);

    expect(actualResponse.status).toBe(HTTP_PAYLOAD_TOO_LARGE);
    expect(mockTelegramService.authenticate).not.toHaveBeenCalled();
  });
});
