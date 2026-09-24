import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { API_KEYS_ENV_VAR } from '../src/config/api-keys.config';
import { API_KEY_HEADER, REQUEST_BODY_MAX_BYTES } from '../src/shared/constants/http.constants';
import { configureHttpPipeline } from '../src/shared/utils/http-pipeline';
import { AUTH_INPUT_ERRORS } from '../src/telegram/constants';
import { TelegramService } from '../src/telegram/telegram.service';
import { closeLifecycleProviders } from './lifecycle-providers';

const AUTH_ROUTE = '/telegram/auth';
const HEALTH_ROUTE = '/telegram/health';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_PAYLOAD_TOO_LARGE = 413;

const INPUT_FAKE_API_KEY = 'fake-e2e-api-key';
const INPUT_UNKNOWN_API_KEY = 'fake-e2e-api-nil';
const INPUT_FAKE_PHONE_NUMBER = '+10000000000';
const INPUT_INVALID_PHONE_CODE = 'not-a-code';
const INPUT_FAKE_PHONE_CODE = '00000';
const INPUT_BLANK_VALUE = '   ';
const INPUT_PADDED_PASSWORD = '  fake-password  ';
const OVERSIZE_OVERSHOOT_BYTES = 2;
const CONTENT_TYPE_HEADER = 'Content-Type';
const CONTENT_TYPE_TEXT = 'text/plain';

const EXPECTED_STEP_ONE_RESPONSE = { needsCode: true, message: 'fake code sent' };

/** One fake number per cycle test: the per-phone limit would otherwise couple the tests. */
const INPUT_CYCLE_PHONE_NUMBER = '+10000000011';
const INPUT_TWO_FACTOR_PHONE_NUMBER = '+10000000012';
const INPUT_WRONG_CODE_PHONE_NUMBER = '+10000000013';
const INPUT_FAKE_TWO_FACTOR_PASSWORD = 'fake-2fa-password';
const EXPECTED_FAKE_SESSION_STRING = 'fake-e2e-session-string';
const EXPECTED_SESSION_RESPONSE = {
  sessionString: EXPECTED_FAKE_SESSION_STRING,
  message: 'fake authenticated',
};
const EXPECTED_NEEDS_PASSWORD_RESPONSE = { needsPassword: true, message: 'fake password needed' };
const PHONE_CODE_INVALID_CODE = 'PHONE_CODE_INVALID';
const EXPECTED_WRONG_CODE_MESSAGE = new Map(AUTH_INPUT_ERRORS).get(PHONE_CODE_INVALID_CODE);

/**
 * Replaces the TelegramService facade. The real lifecycle providers behind it are still built,
 * but none of them creates a client unless the facade calls it, so nothing touches Telegram.
 */
const mockTelegramService = {
  authenticate: jest.fn(),
  checkSession: jest.fn(),
  getChannelPosts: jest.fn(),
};

describe('auth route perimeter (e2e)', () => {
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
    mockTelegramService.authenticate.mockResolvedValue(EXPECTED_STEP_ONE_RESPONSE);
  });

  it('treats an empty phone code and password as absent and runs step one', async () => {
    const inputBody = { phoneNumber: INPUT_FAKE_PHONE_NUMBER, phoneCode: '', password: '' };

    const actualResponse = await request(app.getHttpServer())
      .post(AUTH_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .send(inputBody);

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

    const actualResponse = await request(app.getHttpServer())
      .post(AUTH_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .send(inputBody);

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

    const actualResponse = await request(app.getHttpServer())
      .post(AUTH_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .send(inputBody);

    expect(actualResponse.status).toBe(HTTP_OK);
    expect(mockTelegramService.authenticate).toHaveBeenCalledWith(
      INPUT_FAKE_PHONE_NUMBER,
      INPUT_FAKE_PHONE_CODE,
      INPUT_PADDED_PASSWORD,
    );
  });

  it('rejects a whitespace-only phone number before the service is called', async () => {
    const inputBody = { phoneNumber: INPUT_BLANK_VALUE, phoneCode: '', password: '' };

    const actualResponse = await request(app.getHttpServer())
      .post(AUTH_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .send(inputBody);

    expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
    expect(mockTelegramService.authenticate).not.toHaveBeenCalled();
  });

  it('rejects a non-empty invalid phone code before the service is called', async () => {
    const inputBody = {
      phoneNumber: INPUT_FAKE_PHONE_NUMBER,
      phoneCode: INPUT_INVALID_PHONE_CODE,
      password: '',
    };

    const actualResponse = await request(app.getHttpServer())
      .post(AUTH_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .send(inputBody);

    expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
    expect(mockTelegramService.authenticate).not.toHaveBeenCalled();
  });

  it('rejects an empty phone number before the service is called', async () => {
    const inputBody = { phoneNumber: '', phoneCode: '', password: '' };

    const actualResponse = await request(app.getHttpServer())
      .post(AUTH_ROUTE)
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .send(inputBody);

    expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
    expect(mockTelegramService.authenticate).not.toHaveBeenCalled();
  });

  it('rejects an auth request carrying no caller key before the service is called', async () => {
    const inputBody = { phoneNumber: INPUT_FAKE_PHONE_NUMBER, phoneCode: '', password: '' };

    const actualResponse = await request(app.getHttpServer()).post(AUTH_ROUTE).send(inputBody);

    expect(actualResponse.status).toBe(HTTP_UNAUTHORIZED);
    expect(mockTelegramService.authenticate).not.toHaveBeenCalled();
  });

  it('rejects an auth request carrying an unknown caller key before the service is called', async () => {
    const inputBody = { phoneNumber: INPUT_FAKE_PHONE_NUMBER, phoneCode: '', password: '' };

    const actualResponse = await request(app.getHttpServer())
      .post(AUTH_ROUTE)
      .set(API_KEY_HEADER, INPUT_UNKNOWN_API_KEY)
      .send(inputBody);

    expect(actualResponse.status).toBe(HTTP_UNAUTHORIZED);
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
      .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
      .send(inputOversizedBody);

    expect(actualResponse.status).toBe(HTTP_PAYLOAD_TOO_LARGE);
    expect(mockTelegramService.authenticate).not.toHaveBeenCalled();
  });

  describe('full auth cycle', () => {
    function postAuth(inputBody: Record<string, string>): request.Test {
      return request(app.getHttpServer())
        .post(AUTH_ROUTE)
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .send(inputBody);
    }

    it('asks for a code on step one, then returns the session string on step two', async () => {
      // Arrange
      mockTelegramService.authenticate
        .mockResolvedValueOnce(EXPECTED_STEP_ONE_RESPONSE)
        .mockResolvedValueOnce(EXPECTED_SESSION_RESPONSE);

      // Act
      const actualStepOne = await postAuth({ phoneNumber: INPUT_CYCLE_PHONE_NUMBER });
      const actualStepTwo = await postAuth({
        phoneNumber: INPUT_CYCLE_PHONE_NUMBER,
        phoneCode: INPUT_FAKE_PHONE_CODE,
      });

      // Assert
      expect(actualStepOne.status).toBe(HTTP_OK);
      expect(actualStepOne.body).toEqual(EXPECTED_STEP_ONE_RESPONSE);
      expect(actualStepTwo.status).toBe(HTTP_OK);
      expect(actualStepTwo.body).toEqual(EXPECTED_SESSION_RESPONSE);
      expect(mockTelegramService.authenticate).toHaveBeenNthCalledWith(
        1,
        INPUT_CYCLE_PHONE_NUMBER,
        undefined,
        undefined,
      );
      expect(mockTelegramService.authenticate).toHaveBeenNthCalledWith(
        2,
        INPUT_CYCLE_PHONE_NUMBER,
        INPUT_FAKE_PHONE_CODE,
        undefined,
      );
    });

    it('asks for the 2FA password on step two, then returns the session string on step three', async () => {
      // Arrange
      const expectedStepThreeCall = 3;
      mockTelegramService.authenticate
        .mockResolvedValueOnce(EXPECTED_STEP_ONE_RESPONSE)
        .mockResolvedValueOnce(EXPECTED_NEEDS_PASSWORD_RESPONSE)
        .mockResolvedValueOnce(EXPECTED_SESSION_RESPONSE);

      // Act
      const actualStepOne = await postAuth({ phoneNumber: INPUT_TWO_FACTOR_PHONE_NUMBER });
      const actualStepTwo = await postAuth({
        phoneNumber: INPUT_TWO_FACTOR_PHONE_NUMBER,
        phoneCode: INPUT_FAKE_PHONE_CODE,
      });
      const actualStepThree = await postAuth({
        phoneNumber: INPUT_TWO_FACTOR_PHONE_NUMBER,
        phoneCode: INPUT_FAKE_PHONE_CODE,
        password: INPUT_FAKE_TWO_FACTOR_PASSWORD,
      });

      // Assert
      expect(actualStepOne.body).toEqual(EXPECTED_STEP_ONE_RESPONSE);
      expect(actualStepTwo.status).toBe(HTTP_OK);
      expect(actualStepTwo.body).toEqual(EXPECTED_NEEDS_PASSWORD_RESPONSE);
      expect(actualStepTwo.body.sessionString).toBeUndefined();
      expect(actualStepThree.status).toBe(HTTP_OK);
      expect(actualStepThree.body).toEqual(EXPECTED_SESSION_RESPONSE);
      expect(mockTelegramService.authenticate).toHaveBeenNthCalledWith(
        2,
        INPUT_TWO_FACTOR_PHONE_NUMBER,
        INPUT_FAKE_PHONE_CODE,
        undefined,
      );
      expect(mockTelegramService.authenticate).toHaveBeenNthCalledWith(
        expectedStepThreeCall,
        INPUT_TWO_FACTOR_PHONE_NUMBER,
        INPUT_FAKE_PHONE_CODE,
        INPUT_FAKE_TWO_FACTOR_PASSWORD,
      );
    });

    it('answers 400 with the mapped message when the service rejects a wrong code', async () => {
      // Arrange
      mockTelegramService.authenticate.mockRejectedValue(
        new BadRequestException(EXPECTED_WRONG_CODE_MESSAGE),
      );

      // Act
      const actualResponse = await postAuth({
        phoneNumber: INPUT_WRONG_CODE_PHONE_NUMBER,
        phoneCode: INPUT_FAKE_PHONE_CODE,
      });

      // Assert
      expect(EXPECTED_WRONG_CODE_MESSAGE).toBeDefined();
      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(actualResponse.body.message).toBe(EXPECTED_WRONG_CODE_MESSAGE);
      expect(actualResponse.body.sessionString).toBeUndefined();
      expect(mockTelegramService.authenticate).toHaveBeenCalledWith(
        INPUT_WRONG_CODE_PHONE_NUMBER,
        INPUT_FAKE_PHONE_CODE,
        undefined,
      );
    });
  });
});
