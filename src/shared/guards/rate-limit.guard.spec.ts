import { Logger } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { API_KEY_HEADER } from '../constants/http.constants';
import { RATE_LIMIT_DEFAULT_MAX_REQUESTS } from '../constants/rate-limit.constants';
import { IS_PUBLIC_ROUTE_KEY } from '../decorators/public-route.decorator';
import {
  RETRY_AFTER_HEADER,
  TOO_MANY_REQUESTS_MESSAGE,
  TooManyRequestsException,
} from '../exceptions/too-many-requests.exception';
import { RateLimitGuard } from './rate-limit.guard';

const HTTP_TOO_MANY_REQUESTS = 429;

type MockReflector = { getAllAndOverride: jest.Mock };
type MockResponse = { setHeader: jest.Mock };
type MockContext = { context: ExecutionContext; mockResponse: MockResponse };

const inputCallerKey = 'fake-api-key-one';
const inputOtherCallerKey = 'fake-api-key-two';

function createMockReflector(isPublicRoute?: boolean): MockReflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(isPublicRoute) };
}

function createMockContext(inputApiKey?: string): MockContext {
  const mockHandler = function handler(): void {};
  class MockController {}
  const mockResponse: MockResponse = { setHeader: jest.fn() };
  const mockRequest = {
    headers: inputApiKey === undefined ? {} : { [API_KEY_HEADER]: inputApiKey },
  };

  const context = {
    switchToHttp: () => ({
      getRequest: () => mockRequest,
      getResponse: () => mockResponse,
    }),
    getHandler: () => mockHandler,
    getClass: () => MockController,
  } as unknown as ExecutionContext;

  return { context, mockResponse };
}

function createGuard(mockReflector: MockReflector): RateLimitGuard {
  return new RateLimitGuard(mockReflector as unknown as Reflector);
}

function activateTimes(guard: RateLimitGuard, inputApiKey: string, times: number): boolean[] {
  const results: boolean[] = [];
  for (let attempt = 0; attempt < times; attempt += 1) {
    results.push(guard.canActivate(createMockContext(inputApiKey).context));
  }

  return results;
}

function readLoggedArguments(): string {
  return [
    Logger.prototype.log,
    Logger.prototype.error,
    Logger.prototype.warn,
    Logger.prototype.debug,
    Logger.prototype.verbose,
    Logger.prototype.fatal,
  ]
    .flatMap((loggerMethod) => (loggerMethod as jest.Mock).mock.calls.flat())
    .map((loggedArgument) => String(loggedArgument))
    .join(' ');
}

describe('RateLimitGuard', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'fatal').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows every request up to the configured limit', () => {
    const inputGuard = createGuard(createMockReflector(undefined));

    const actualResults = activateTimes(
      inputGuard,
      inputCallerKey,
      RATE_LIMIT_DEFAULT_MAX_REQUESTS,
    );

    expect(actualResults).toHaveLength(RATE_LIMIT_DEFAULT_MAX_REQUESTS);
    expect(actualResults.every((actualResult) => actualResult === true)).toBe(true);
  });

  it('rejects the request after the limit with a 429', () => {
    const inputGuard = createGuard(createMockReflector(undefined));
    activateTimes(inputGuard, inputCallerKey, RATE_LIMIT_DEFAULT_MAX_REQUESTS);
    const mockContext = createMockContext(inputCallerKey);
    let actualError: TooManyRequestsException | undefined;

    try {
      inputGuard.canActivate(mockContext.context);
    } catch (caughtError) {
      actualError = caughtError as TooManyRequestsException;
    }

    expect(actualError).toBeInstanceOf(TooManyRequestsException);
    expect(actualError?.getStatus()).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(actualError?.message).toContain(TOO_MANY_REQUESTS_MESSAGE);
  });

  it('sets a Retry-After header on the rejected response', () => {
    const inputGuard = createGuard(createMockReflector(undefined));
    activateTimes(inputGuard, inputCallerKey, RATE_LIMIT_DEFAULT_MAX_REQUESTS);
    const mockContext = createMockContext(inputCallerKey);

    expect(() => inputGuard.canActivate(mockContext.context)).toThrow(TooManyRequestsException);

    expect(mockContext.mockResponse.setHeader).toHaveBeenCalledWith(
      RETRY_AFTER_HEADER,
      expect.any(Number),
    );
    const [, actualRetryAfterSeconds] = mockContext.mockResponse.setHeader.mock.calls[0];
    expect(actualRetryAfterSeconds).toBeGreaterThan(0);
  });

  it('still serves a different caller key once one key is exhausted', () => {
    const inputGuard = createGuard(createMockReflector(undefined));
    activateTimes(inputGuard, inputCallerKey, RATE_LIMIT_DEFAULT_MAX_REQUESTS);

    expect(() => inputGuard.canActivate(createMockContext(inputCallerKey).context)).toThrow(
      TooManyRequestsException,
    );
    const actualOtherResult = inputGuard.canActivate(
      createMockContext(inputOtherCallerKey).context,
    );

    expect(actualOtherResult).toBe(true);
  });

  it('counts requests without a key header as one anonymous caller', () => {
    const inputGuard = createGuard(createMockReflector(undefined));
    for (let attempt = 0; attempt < RATE_LIMIT_DEFAULT_MAX_REQUESTS; attempt += 1) {
      inputGuard.canActivate(createMockContext(undefined).context);
    }

    expect(() => inputGuard.canActivate(createMockContext(undefined).context)).toThrow(
      TooManyRequestsException,
    );
  });

  it('reads the public-route metadata from the handler and the class', () => {
    const mockReflector = createMockReflector(true);
    const mockContext = createMockContext(inputCallerKey);

    createGuard(mockReflector).canActivate(mockContext.context);

    expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_ROUTE_KEY, [
      mockContext.context.getHandler(),
      mockContext.context.getClass(),
    ]);
  });

  it('never counts a public route, however often it is called', () => {
    const inputGuard = createGuard(createMockReflector(true));

    const actualResults = activateTimes(
      inputGuard,
      inputCallerKey,
      RATE_LIMIT_DEFAULT_MAX_REQUESTS + 1,
    );

    expect(actualResults.every((actualResult) => actualResult === true)).toBe(true);
  });

  it('leaves the guarded budget untouched after a flood of public-route calls', () => {
    const mockReflector = createMockReflector(true);
    const inputGuard = createGuard(mockReflector);
    activateTimes(inputGuard, inputCallerKey, RATE_LIMIT_DEFAULT_MAX_REQUESTS + 1);

    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    const actualResults = activateTimes(
      inputGuard,
      inputCallerKey,
      RATE_LIMIT_DEFAULT_MAX_REQUESTS,
    );

    expect(actualResults.every((actualResult) => actualResult === true)).toBe(true);
  });

  it('passes no caller key to any logger level, on the allowed and on the rejected path', () => {
    const inputGuard = createGuard(createMockReflector(undefined));
    activateTimes(inputGuard, inputCallerKey, RATE_LIMIT_DEFAULT_MAX_REQUESTS);

    expect(() => inputGuard.canActivate(createMockContext(inputCallerKey).context)).toThrow(
      TooManyRequestsException,
    );

    expect(readLoggedArguments()).not.toContain(inputCallerKey);
  });

  it('keeps the caller key out of the rejection the caller receives', () => {
    const inputGuard = createGuard(createMockReflector(undefined));
    activateTimes(inputGuard, inputCallerKey, RATE_LIMIT_DEFAULT_MAX_REQUESTS);
    let actualError: TooManyRequestsException | undefined;

    try {
      inputGuard.canActivate(createMockContext(inputCallerKey).context);
    } catch (caughtError) {
      actualError = caughtError as TooManyRequestsException;
    }

    expect(JSON.stringify(actualError?.getResponse())).not.toContain(inputCallerKey);
  });
});
