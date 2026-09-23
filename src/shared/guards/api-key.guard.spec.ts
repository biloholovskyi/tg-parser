import { Logger, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { API_KEYS_ENV_VAR } from '../../config/api-keys.config';
import { API_KEY_HEADER } from '../constants/http.constants';
import { IS_PUBLIC_ROUTE_KEY } from '../decorators/public-route.decorator';
import { ApiKeyGuard, UNAUTHORIZED_MESSAGE } from './api-key.guard';

const HTTP_UNAUTHORIZED = 401;

type MockReflector = { getAllAndOverride: jest.Mock };
type InputHeaders = Record<string, string | string[]>;

function createMockReflector(isPublicRoute?: boolean): MockReflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(isPublicRoute) };
}

function createMockExecutionContext(inputHeaders: InputHeaders): ExecutionContext {
  const mockHandler = function handler(): void {};
  class MockController {}

  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: inputHeaders }) }),
    getHandler: () => mockHandler,
    getClass: () => MockController,
  } as unknown as ExecutionContext;
}

function createGuard(mockReflector: MockReflector): ApiKeyGuard {
  return new ApiKeyGuard(mockReflector as unknown as Reflector);
}

describe('ApiKeyGuard', () => {
  const originalEnv = process.env;
  const inputKnownApiKey = 'fake-api-key-one';
  const inputSecondKnownApiKey = 'fake-api-key-two';
  const inputUnknownApiKey = 'fake-api-key-nil';
  const inputShortApiKey = 'fake-api-key';

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env[API_KEYS_ENV_VAR] = `${inputKnownApiKey},${inputSecondKnownApiKey}`;
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('allows a request carrying a configured key', () => {
    const mockReflector = createMockReflector(undefined);
    const mockContext = createMockExecutionContext({ [API_KEY_HEADER]: inputKnownApiKey });

    const actualResult = createGuard(mockReflector).canActivate(mockContext);

    expect(actualResult).toBe(true);
  });

  it('allows a request carrying any configured key, not only the first', () => {
    const mockReflector = createMockReflector(undefined);
    const mockContext = createMockExecutionContext({ [API_KEY_HEADER]: inputSecondKnownApiKey });

    const actualResult = createGuard(mockReflector).canActivate(mockContext);

    expect(actualResult).toBe(true);
  });

  it('rejects an unknown key of the same length as a configured one', () => {
    const mockReflector = createMockReflector(undefined);
    const mockContext = createMockExecutionContext({ [API_KEY_HEADER]: inputUnknownApiKey });

    expect(() => createGuard(mockReflector).canActivate(mockContext)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request with no key header at all', () => {
    const mockReflector = createMockReflector(undefined);
    const mockContext = createMockExecutionContext({});

    expect(() => createGuard(mockReflector).canActivate(mockContext)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an empty key header', () => {
    const mockReflector = createMockReflector(undefined);
    const mockContext = createMockExecutionContext({ [API_KEY_HEADER]: '' });

    expect(() => createGuard(mockReflector).canActivate(mockContext)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a key that is a shorter prefix of a configured one', () => {
    const mockReflector = createMockReflector(undefined);
    const mockContext = createMockExecutionContext({ [API_KEY_HEADER]: inputShortApiKey });

    expect(() => createGuard(mockReflector).canActivate(mockContext)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a repeated key header delivered as an array, even when a value is configured', () => {
    const mockReflector = createMockReflector(undefined);
    const mockContext = createMockExecutionContext({
      [API_KEY_HEADER]: [inputKnownApiKey, inputUnknownApiKey],
    });

    expect(() => createGuard(mockReflector).canActivate(mockContext)).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a plausible key when no key is configured', () => {
    delete process.env[API_KEYS_ENV_VAR];
    const mockReflector = createMockReflector(undefined);
    const mockContext = createMockExecutionContext({ [API_KEY_HEADER]: inputKnownApiKey });

    expect(() => createGuard(mockReflector).canActivate(mockContext)).toThrow(
      UnauthorizedException,
    );
  });

  it('answers every rejection with the same message, revealing nothing about the cause', () => {
    const mockReflector = createMockReflector(undefined);
    const inputRejectedHeaders: InputHeaders[] = [
      {},
      { [API_KEY_HEADER]: '' },
      { [API_KEY_HEADER]: inputUnknownApiKey },
      { [API_KEY_HEADER]: inputShortApiKey },
      { [API_KEY_HEADER]: [inputKnownApiKey] },
    ];

    const actualMessages = inputRejectedHeaders.map((inputHeaders) => {
      try {
        createGuard(mockReflector).canActivate(createMockExecutionContext(inputHeaders));
        return 'allowed';
      } catch (caughtError) {
        return (caughtError as UnauthorizedException).message;
      }
    });

    const expectedMessages = inputRejectedHeaders.map(() => UNAUTHORIZED_MESSAGE);
    expect(actualMessages).toEqual(expectedMessages);
  });

  it('answers a rejection with the 401 status', () => {
    const mockReflector = createMockReflector(undefined);
    const mockContext = createMockExecutionContext({ [API_KEY_HEADER]: inputUnknownApiKey });
    let actualError: UnauthorizedException | undefined;

    try {
      createGuard(mockReflector).canActivate(mockContext);
    } catch (caughtError) {
      actualError = caughtError as UnauthorizedException;
    }

    expect(actualError).toBeInstanceOf(UnauthorizedException);
    expect(actualError?.getStatus()).toBe(HTTP_UNAUTHORIZED);
  });

  it('reads the public-route metadata from the handler and the class', () => {
    const mockReflector = createMockReflector(true);
    const mockContext = createMockExecutionContext({});

    createGuard(mockReflector).canActivate(mockContext);

    expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_ROUTE_KEY, [
      mockContext.getHandler(),
      mockContext.getClass(),
    ]);
  });

  it('allows a public route with no key header and without reading the configured keys', () => {
    delete process.env[API_KEYS_ENV_VAR];
    const mockReflector = createMockReflector(true);
    const mockContext = createMockExecutionContext({});

    const actualResult = createGuard(mockReflector).canActivate(mockContext);

    expect(actualResult).toBe(true);
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });
});
