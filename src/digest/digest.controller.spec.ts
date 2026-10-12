import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { IS_PUBLIC_ROUTE_KEY } from '../shared/decorators/public-route.decorator';
import { MISSING_SESSION_MESSAGE } from '../shared/utils/session-header';
import { TelegramService } from '../telegram/telegram.service';
import { DigestController } from './digest.controller';
import { DigestService } from './digest.service';
import type { DigestRunResponse } from './interfaces/digest-run.interface';

/** The real facade loads GramJS at import time; the controller only needs the DI token. */
jest.mock('../telegram/telegram.service', () => ({ TelegramService: class {} }));
/** The real digest service pulls in the collector and, through it, the facade. */
jest.mock('./digest.service', () => ({ DigestService: class {} }));

type MockTelegramService = {
  markDigestSession: jest.Mock<Promise<void>, [string]>;
};

type MockDigestService = {
  start: jest.Mock<DigestRunResponse, []>;
};

const INPUT_FAKE_SESSION_STRING = 'fake-digest-session-string';

describe('DigestController', () => {
  let controller: DigestController;
  let mockTelegramService: MockTelegramService;
  let mockDigestService: MockDigestService;

  beforeEach(async () => {
    mockTelegramService = { markDigestSession: jest.fn().mockResolvedValue(undefined) };
    mockDigestService = { start: jest.fn(() => ({ status: 'started' as const })) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DigestController],
      providers: [
        { provide: TelegramService, useValue: mockTelegramService },
        { provide: DigestService, useValue: mockDigestService },
      ],
    }).compile();

    controller = moduleRef.get(DigestController);
  });

  describe('PUT /digest/session', () => {
    it('is routed as PUT digest/session with status 204', () => {
      // Arrange
      const handler = DigestController.prototype.markSession;

      // Act
      const actualControllerPath = Reflect.getMetadata(PATH_METADATA, DigestController);
      const actualPath = Reflect.getMetadata(PATH_METADATA, handler);
      const actualMethod = Reflect.getMetadata(METHOD_METADATA, handler);
      const actualCode = Reflect.getMetadata(HTTP_CODE_METADATA, handler);

      // Assert
      expect(actualControllerPath).toBe('digest');
      expect(actualPath).toBe('session');
      expect(actualMethod).toBe(RequestMethod.PUT);
      expect(actualCode).toBe(HttpStatus.NO_CONTENT);
    });

    it('is not a public route, so the API key guard applies', () => {
      // Act
      const actualIsPublic = new Reflector().getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
        DigestController.prototype.markSession,
        DigestController,
      ]);

      // Assert
      expect(actualIsPublic).toBeFalsy();
    });

    it('delegates the session to the facade and resolves with no body', async () => {
      // Act
      const actualResult = await controller.markSession(INPUT_FAKE_SESSION_STRING);

      // Assert
      expect(actualResult).toBeUndefined();
      expect(mockTelegramService.markDigestSession).toHaveBeenCalledTimes(1);
      expect(mockTelegramService.markDigestSession).toHaveBeenCalledWith(INPUT_FAKE_SESSION_STRING);
    });

    it('rejects a missing session header with 400 and never calls the facade', async () => {
      // Act
      const actualResult = controller.markSession('');

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(BadRequestException);
      await expect(actualResult).rejects.toThrow(MISSING_SESSION_MESSAGE);
      expect(mockTelegramService.markDigestSession).not.toHaveBeenCalled();
    });

    it('propagates the 401 of an unknown session from the facade', async () => {
      // Arrange
      const inputError = new UnauthorizedException('fake invalid session');
      mockTelegramService.markDigestSession.mockRejectedValueOnce(inputError);

      // Act
      const actualResult = controller.markSession(INPUT_FAKE_SESSION_STRING);

      // Assert
      await expect(actualResult).rejects.toBe(inputError);
    });
  });

  describe('POST /digest/run', () => {
    it('is routed as POST digest/run with status 202', () => {
      // Arrange
      const handler = DigestController.prototype.run;

      // Act
      const actualPath = Reflect.getMetadata(PATH_METADATA, handler);
      const actualMethod = Reflect.getMetadata(METHOD_METADATA, handler);
      const actualCode = Reflect.getMetadata(HTTP_CODE_METADATA, handler);

      // Assert
      expect(actualPath).toBe('run');
      expect(actualMethod).toBe(RequestMethod.POST);
      expect(actualCode).toBe(HttpStatus.ACCEPTED);
    });

    it('is not a public route, so the API key guard applies', () => {
      // Act
      const actualIsPublic = new Reflector().getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
        DigestController.prototype.run,
        DigestController,
      ]);

      // Assert
      expect(actualIsPublic).toBeFalsy();
    });

    it('delegates to the digest service and returns its response', () => {
      // Act
      const actualResponse = controller.run();

      // Assert
      expect(actualResponse).toEqual({ status: 'started' });
      expect(mockDigestService.start).toHaveBeenCalledTimes(1);
      expect(mockTelegramService.markDigestSession).not.toHaveBeenCalled();
    });

    it.each([
      ['409', new ConflictException('fake already running')],
      ['503', new ServiceUnavailableException('fake not configured')],
    ])('propagates the %s from the digest service', (_label, inputError) => {
      // Arrange
      mockDigestService.start.mockImplementationOnce(() => {
        throw inputError;
      });

      // Act
      const actualAct = (): unknown => controller.run();

      // Assert
      expect(actualAct).toThrow(inputError);
    });
  });
});
