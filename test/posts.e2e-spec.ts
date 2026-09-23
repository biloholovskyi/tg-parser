import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { API_KEYS_ENV_VAR } from '../src/config/api-keys.config';
import { API_KEY_HEADER, SESSION_HEADER } from '../src/shared/constants/http.constants';
import { TooManyRequestsException } from '../src/shared/exceptions/too-many-requests.exception';
import { configureHttpPipeline } from '../src/shared/utils/http-pipeline';
import {
  CHANNEL_USERNAME_MAX_LENGTH,
  CHANNEL_USERNAME_MIN_LENGTH,
  HOURS_BACK_DEFAULT,
  HOURS_BACK_MAX,
  HOURS_BACK_MIN,
} from '../src/telegram/dto/messages.dto';
import { TelegramService } from '../src/telegram/telegram.service';
import {
  CHANNEL_UNAVAILABLE_MESSAGE,
  INVALID_SESSION_MESSAGE,
} from '../src/telegram/utils/telegram-errors';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;

const OUT_OF_RANGE_STEP = 1;
const FIRST_CHARACTER_LENGTH = 1;

const INPUT_FAKE_API_KEY = 'fake-e2e-api-key';
const INPUT_FAKE_CHANNEL = 'fakechannel';
/** Carries a space and a plus on purpose: the old query transport rewrote one into the other. */
const INPUT_FAKE_SESSION_STRING = 'fake session+string==';
const INPUT_PADDED_SESSION_STRING = `  ${INPUT_FAKE_SESSION_STRING}  `;
const INPUT_WHITESPACE_ONLY_SESSION_STRING = '   ';
const INPUT_MALFORMED_CHANNEL = '1bad.channel';

const EXPECTED_POSTS_RESPONSE = { posts: [], count: 0, isTruncated: false };
const INPUT_FLOOD_SECONDS = 30;

/** No real TelegramService is constructed, so nothing touches Telegram or the filesystem. */
const mockTelegramService = {
  authenticate: jest.fn(),
  checkSession: jest.fn(),
  getChannelPosts: jest.fn(),
  disconnect: jest.fn(),
};

function buildChannelUsername(length: number): string {
  return `c${'h'.repeat(length - FIRST_CHARACTER_LENGTH)}`;
}

function buildPostsRoute(channelUsername: string): string {
  return `/telegram/channel/${channelUsername}/posts`;
}

describe('channel posts route (e2e)', () => {
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
    mockTelegramService.getChannelPosts.mockResolvedValue(EXPECTED_POSTS_RESPONSE);
  });

  describe('session transport', () => {
    it('serves a request whose credential travels in the session header', async () => {
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      expect(actualResponse.status).toBe(HTTP_OK);
      expect(actualResponse.body).toEqual(EXPECTED_POSTS_RESPONSE);
    });

    it('hands the service the exact session string from the header, without rewriting spaces', async () => {
      await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      expect(mockTelegramService.getChannelPosts).toHaveBeenCalledWith(
        INPUT_FAKE_CHANNEL,
        INPUT_FAKE_SESSION_STRING,
        HOURS_BACK_DEFAULT,
      );
    });

    it('trims only the surrounding whitespace of the header value', async () => {
      await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_PADDED_SESSION_STRING);

      expect(mockTelegramService.getChannelPosts).toHaveBeenCalledWith(
        INPUT_FAKE_CHANNEL,
        INPUT_FAKE_SESSION_STRING,
        HOURS_BACK_DEFAULT,
      );
    });

    it('rejects a credential sent in the query string, which no longer travels in a URL', async () => {
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .query({ sessionString: INPUT_FAKE_SESSION_STRING });

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockTelegramService.getChannelPosts).not.toHaveBeenCalled();
    });

    it('rejects a request carrying no session header', async () => {
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY);

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockTelegramService.getChannelPosts).not.toHaveBeenCalled();
    });

    it('rejects a whitespace-only session header, which counts as absent', async () => {
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_WHITESPACE_ONLY_SESSION_STRING);

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockTelegramService.getChannelPosts).not.toHaveBeenCalled();
    });

    it('never echoes the session string back in the response body', async () => {
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      expect(JSON.stringify(actualResponse.body)).not.toContain(INPUT_FAKE_SESSION_STRING);
    });
  });

  describe('response contract', () => {
    it('returns isTruncated from the service unchanged', async () => {
      // Arrange
      const expectedBody = { posts: [], count: 0, isTruncated: true };
      mockTelegramService.getChannelPosts.mockResolvedValue(expectedBody);

      // Act
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      // Assert
      expect(actualResponse.status).toBe(HTTP_OK);
      expect(actualResponse.body).toEqual(expectedBody);
    });
  });

  describe('mapped Telegram failures', () => {
    it('answers 401 when the service rejects the session', async () => {
      // Arrange
      mockTelegramService.getChannelPosts.mockRejectedValue(
        new UnauthorizedException(INVALID_SESSION_MESSAGE),
      );

      // Act
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      // Assert
      expect(actualResponse.status).toBe(HTTP_UNAUTHORIZED);
      expect(actualResponse.body.message).toBe(INVALID_SESSION_MESSAGE);
    });

    it('answers 404 when the channel is not accessible', async () => {
      // Arrange
      mockTelegramService.getChannelPosts.mockRejectedValue(
        new NotFoundException(CHANNEL_UNAVAILABLE_MESSAGE),
      );

      // Act
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      // Assert
      expect(actualResponse.status).toBe(HTTP_NOT_FOUND);
      expect(actualResponse.body.message).toBe(CHANNEL_UNAVAILABLE_MESSAGE);
    });

    it('answers 429 with the wait duration on a Telegram flood wait', async () => {
      // Arrange
      mockTelegramService.getChannelPosts.mockRejectedValue(
        new TooManyRequestsException(INPUT_FLOOD_SECONDS),
      );

      // Act
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      // Assert
      expect(actualResponse.status).toBe(HTTP_TOO_MANY_REQUESTS);
      expect(actualResponse.body.retryAfterSeconds).toBe(INPUT_FLOOD_SECONDS);
    });
  });

  describe('caller authentication', () => {
    it('rejects a request carrying no caller key before the service is called', async () => {
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      expect(actualResponse.status).toBe(HTTP_UNAUTHORIZED);
      expect(mockTelegramService.getChannelPosts).not.toHaveBeenCalled();
    });
  });

  describe('hoursBack window', () => {
    it('passes an accepted hours window through to the service', async () => {
      await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING)
        .query({ hoursBack: String(HOURS_BACK_MAX) });

      expect(mockTelegramService.getChannelPosts).toHaveBeenCalledWith(
        INPUT_FAKE_CHANNEL,
        INPUT_FAKE_SESSION_STRING,
        HOURS_BACK_MAX,
      );
    });

    it('rejects an hours window below the minimum before the service is called', async () => {
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING)
        .query({ hoursBack: String(HOURS_BACK_MIN - OUT_OF_RANGE_STEP) });

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockTelegramService.getChannelPosts).not.toHaveBeenCalled();
    });

    it('rejects an hours window above the maximum before the service is called', async () => {
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING)
        .query({ hoursBack: String(HOURS_BACK_MAX + OUT_OF_RANGE_STEP) });

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockTelegramService.getChannelPosts).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric hours window before the service is called', async () => {
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_FAKE_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING)
        .query({ hoursBack: 'many' });

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockTelegramService.getChannelPosts).not.toHaveBeenCalled();
    });
  });

  describe('channel username validation', () => {
    it('accepts a channel username carrying the leading at sign', async () => {
      const inputChannelUsername = `@${INPUT_FAKE_CHANNEL}`;

      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(encodeURIComponent(inputChannelUsername)))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      expect(actualResponse.status).toBe(HTTP_OK);
      expect(mockTelegramService.getChannelPosts).toHaveBeenCalledWith(
        inputChannelUsername,
        INPUT_FAKE_SESSION_STRING,
        HOURS_BACK_DEFAULT,
      );
    });

    it('rejects a malformed channel username before the service is called', async () => {
      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(INPUT_MALFORMED_CHANNEL))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockTelegramService.getChannelPosts).not.toHaveBeenCalled();
    });

    it('rejects a channel username shorter than the minimum length', async () => {
      const inputChannelUsername = buildChannelUsername(
        CHANNEL_USERNAME_MIN_LENGTH - OUT_OF_RANGE_STEP,
      );

      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(inputChannelUsername))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockTelegramService.getChannelPosts).not.toHaveBeenCalled();
    });

    it('rejects a channel username longer than the maximum length', async () => {
      const inputChannelUsername = buildChannelUsername(
        CHANNEL_USERNAME_MAX_LENGTH + OUT_OF_RANGE_STEP,
      );

      const actualResponse = await request(app.getHttpServer())
        .get(buildPostsRoute(inputChannelUsername))
        .set(API_KEY_HEADER, INPUT_FAKE_API_KEY)
        .set(SESSION_HEADER, INPUT_FAKE_SESSION_STRING);

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockTelegramService.getChannelPosts).not.toHaveBeenCalled();
    });
  });
});
