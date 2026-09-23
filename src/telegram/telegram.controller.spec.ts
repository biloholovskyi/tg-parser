import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { IS_PHONE_RATE_LIMITED_KEY } from '../shared/decorators/phone-rate-limited.decorator';
import { IS_PUBLIC_ROUTE_KEY } from '../shared/decorators/public-route.decorator';
import type { AuthResponseDto, CompleteAuthDto } from './dto/auth.dto';
import type { ChannelPostsParamsDto, GetPostsQueryDto } from './dto/messages.dto';
import { HOURS_BACK_DEFAULT, HOURS_BACK_MAX } from './dto/messages.dto';
import type { GetPostsResponse } from './interfaces/message.interface';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

/** The real service pulls in GramJS at import time; the controller only needs the DI token. */
jest.mock('./telegram.service', () => ({ TelegramService: class MockTelegramService {} }));

type MockTelegramService = {
  authenticate: jest.Mock<Promise<AuthResponseDto>, [string, string?, string?]>;
  checkSession: jest.Mock<Promise<{ status: 'success' | 'failed' }>, [string]>;
  getChannelPosts: jest.Mock<Promise<GetPostsResponse>, [string, string, number]>;
};

const INPUT_FAKE_PHONE_NUMBER = '+10000000000';
const INPUT_FAKE_PHONE_CODE = '00000';
const INPUT_FAKE_PASSWORD = 'fake-password';
const INPUT_FAKE_SESSION_STRING = 'fake-session-string';
const INPUT_FAKE_CHANNEL_USERNAME = 'fakechannel';
const INPUT_EXPLICIT_HOURS_BACK = HOURS_BACK_MAX;

function buildParams(): ChannelPostsParamsDto {
  return { channelUsername: INPUT_FAKE_CHANNEL_USERNAME };
}

function buildPostsResponse(): GetPostsResponse {
  return { posts: [], count: 0, isTruncated: false };
}

describe('TelegramController', () => {
  let controller: TelegramController;
  let mockTelegramService: MockTelegramService;
  const reflector = new Reflector();

  beforeEach(async () => {
    mockTelegramService = {
      authenticate: jest.fn(),
      checkSession: jest.fn(),
      getChannelPosts: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TelegramController],
      providers: [{ provide: TelegramService, useValue: mockTelegramService }],
    }).compile();

    controller = moduleRef.get(TelegramController);
  });

  function expectServiceUntouched(): void {
    expect(mockTelegramService.authenticate).not.toHaveBeenCalled();
    expect(mockTelegramService.checkSession).not.toHaveBeenCalled();
    expect(mockTelegramService.getChannelPosts).not.toHaveBeenCalled();
  }

  describe('health', () => {
    it('returns the constant ok payload', () => {
      const actualResponse = controller.health();

      expect(actualResponse).toEqual({ status: 'ok' });
    });

    it('never touches the Telegram service', () => {
      controller.health();

      expectServiceUntouched();
    });

    it('carries the public-route metadata so the api key guard lets it through', () => {
      const actualMetadata = reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
        TelegramController.prototype.health,
        TelegramController,
      ]);

      expect(actualMetadata).toBe(true);
    });

    it('is the only public route on the controller', () => {
      const inputGuardedHandlers = [
        TelegramController.prototype.authenticate,
        TelegramController.prototype.checkSession,
        TelegramController.prototype.getChannelPosts,
      ];

      const actualMetadata = inputGuardedHandlers.map((handler) =>
        reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [handler, TelegramController]),
      );

      expect(actualMetadata).toEqual([undefined, undefined, undefined]);
    });
  });

  describe('authenticate', () => {
    it('passes phone number, code and password to the service in that order', async () => {
      const inputDto: CompleteAuthDto = {
        phoneNumber: INPUT_FAKE_PHONE_NUMBER,
        phoneCode: INPUT_FAKE_PHONE_CODE,
        password: INPUT_FAKE_PASSWORD,
      };
      const expectedResponse: AuthResponseDto = {
        sessionString: INPUT_FAKE_SESSION_STRING,
        message: 'fake success',
      };
      mockTelegramService.authenticate.mockResolvedValue(expectedResponse);

      const actualResponse = await controller.authenticate(inputDto);

      expect(mockTelegramService.authenticate).toHaveBeenCalledTimes(1);
      expect(mockTelegramService.authenticate).toHaveBeenCalledWith(
        INPUT_FAKE_PHONE_NUMBER,
        INPUT_FAKE_PHONE_CODE,
        INPUT_FAKE_PASSWORD,
      );
      expect(actualResponse).toBe(expectedResponse);
    });

    it('sends undefined code and password on the phone-only first step', async () => {
      const inputDto: CompleteAuthDto = { phoneNumber: INPUT_FAKE_PHONE_NUMBER };
      const expectedResponse: AuthResponseDto = { needsCode: true, message: 'fake code sent' };
      mockTelegramService.authenticate.mockResolvedValue(expectedResponse);

      const actualResponse = await controller.authenticate(inputDto);

      expect(mockTelegramService.authenticate).toHaveBeenCalledWith(
        INPUT_FAKE_PHONE_NUMBER,
        undefined,
        undefined,
      );
      expect(actualResponse).toBe(expectedResponse);
    });

    it('propagates a service rejection unchanged', async () => {
      const inputDto: CompleteAuthDto = {
        phoneNumber: INPUT_FAKE_PHONE_NUMBER,
        phoneCode: INPUT_FAKE_PHONE_CODE,
      };
      const expectedError = new BadRequestException('fake invalid code');
      mockTelegramService.authenticate.mockRejectedValue(expectedError);

      const actualPromise = controller.authenticate(inputDto);

      await expect(actualPromise).rejects.toBe(expectedError);
    });

    it('carries the phone-rate-limited metadata', () => {
      const actualMetadata = reflector.getAllAndOverride<boolean>(IS_PHONE_RATE_LIMITED_KEY, [
        TelegramController.prototype.authenticate,
        TelegramController,
      ]);

      expect(actualMetadata).toBe(true);
    });

    it('is the only phone-rate-limited route', () => {
      const inputOtherHandlers = [
        TelegramController.prototype.health,
        TelegramController.prototype.checkSession,
        TelegramController.prototype.getChannelPosts,
      ];

      const actualMetadata = inputOtherHandlers.map((handler) =>
        reflector.getAllAndOverride<boolean>(IS_PHONE_RATE_LIMITED_KEY, [
          handler,
          TelegramController,
        ]),
      );

      expect(actualMetadata).toEqual([undefined, undefined, undefined]);
    });
  });

  describe('checkSession', () => {
    it.each([
      ['an empty', ''],
      ['an undefined', undefined],
    ])(
      'answers failed for %s session string without calling the service',
      async (_label, input) => {
        const actualResponse = await controller.checkSession(input);

        expect(actualResponse).toEqual({ status: 'failed' });
        expectServiceUntouched();
      },
    );

    it('delegates a non-empty session string to the service and returns its verdict', async () => {
      const expectedResponse = { status: 'success' as const };
      mockTelegramService.checkSession.mockResolvedValue(expectedResponse);

      const actualResponse = await controller.checkSession(INPUT_FAKE_SESSION_STRING);

      expect(mockTelegramService.checkSession).toHaveBeenCalledTimes(1);
      expect(mockTelegramService.checkSession).toHaveBeenCalledWith(INPUT_FAKE_SESSION_STRING);
      expect(actualResponse).toBe(expectedResponse);
    });

    it('returns a failed verdict from the service as is', async () => {
      const expectedResponse = { status: 'failed' as const };
      mockTelegramService.checkSession.mockResolvedValue(expectedResponse);

      const actualResponse = await controller.checkSession(INPUT_FAKE_SESSION_STRING);

      expect(actualResponse).toBe(expectedResponse);
    });

    it('propagates a transport failure instead of reporting failed', async () => {
      const expectedError = new ServiceUnavailableException('fake transport failure');
      mockTelegramService.checkSession.mockRejectedValue(expectedError);

      const actualPromise = controller.checkSession(INPUT_FAKE_SESSION_STRING);

      await expect(actualPromise).rejects.toBe(expectedError);
    });
  });

  describe('getChannelPosts', () => {
    it.each([
      ['empty', ''],
      ['undefined', undefined],
    ])(
      'rejects a %s session string with BadRequestException and no service call',
      async (_label, input) => {
        const inputQuery: GetPostsQueryDto = { hoursBack: HOURS_BACK_DEFAULT };

        const actualPromise = controller.getChannelPosts(buildParams(), inputQuery, input);

        await expect(actualPromise).rejects.toBeInstanceOf(BadRequestException);
        expectServiceUntouched();
      },
    );

    it('names the session header in the missing-session message', async () => {
      const actualPromise = controller.getChannelPosts(buildParams(), {}, '');

      await expect(actualPromise).rejects.toThrow('x-session-string');
    });

    it('falls back to HOURS_BACK_DEFAULT when hoursBack is absent', async () => {
      mockTelegramService.getChannelPosts.mockResolvedValue(buildPostsResponse());

      await controller.getChannelPosts(buildParams(), {}, INPUT_FAKE_SESSION_STRING);

      expect(mockTelegramService.getChannelPosts).toHaveBeenCalledWith(
        INPUT_FAKE_CHANNEL_USERNAME,
        INPUT_FAKE_SESSION_STRING,
        HOURS_BACK_DEFAULT,
      );
    });

    it('passes an explicit hoursBack, the channel username and the session through', async () => {
      const inputQuery: GetPostsQueryDto = { hoursBack: INPUT_EXPLICIT_HOURS_BACK };
      mockTelegramService.getChannelPosts.mockResolvedValue(buildPostsResponse());

      await controller.getChannelPosts(buildParams(), inputQuery, INPUT_FAKE_SESSION_STRING);

      expect(mockTelegramService.getChannelPosts).toHaveBeenCalledTimes(1);
      expect(mockTelegramService.getChannelPosts).toHaveBeenCalledWith(
        INPUT_FAKE_CHANNEL_USERNAME,
        INPUT_FAKE_SESSION_STRING,
        INPUT_EXPLICIT_HOURS_BACK,
      );
    });

    it('returns the service response unchanged', async () => {
      const expectedResponse = buildPostsResponse();
      mockTelegramService.getChannelPosts.mockResolvedValue(expectedResponse);

      const actualResponse = await controller.getChannelPosts(
        buildParams(),
        { hoursBack: HOURS_BACK_DEFAULT },
        INPUT_FAKE_SESSION_STRING,
      );

      expect(actualResponse).toBe(expectedResponse);
    });

    it('propagates a service error unchanged', async () => {
      const expectedError = new ServiceUnavailableException('fake transport failure');
      mockTelegramService.getChannelPosts.mockRejectedValue(expectedError);

      const actualPromise = controller.getChannelPosts(
        buildParams(),
        { hoursBack: HOURS_BACK_DEFAULT },
        INPUT_FAKE_SESSION_STRING,
      );

      await expect(actualPromise).rejects.toBe(expectedError);
    });
  });
});
