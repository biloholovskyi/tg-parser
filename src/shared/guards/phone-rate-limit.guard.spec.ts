import { Logger } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { API_KEY_HEADER } from '../constants/http.constants';
import { RATE_LIMIT_AUTH_MAX_REQUESTS } from '../constants/rate-limit.constants';
import { IS_PHONE_RATE_LIMITED_KEY } from '../decorators/phone-rate-limited.decorator';
import {
  RETRY_AFTER_HEADER,
  TooManyRequestsException,
} from '../exceptions/too-many-requests.exception';
import { PhoneRateLimitGuard } from './phone-rate-limit.guard';

const HTTP_TOO_MANY_REQUESTS = 429;

type MockReflector = { getAllAndOverride: jest.Mock };
type MockResponse = { setHeader: jest.Mock };
type MockContext = { context: ExecutionContext; mockResponse: MockResponse };
type InputRequestBody = unknown;

const inputPhoneNumber = '+10000000000';
const inputPhoneNumberWithoutPlus = '10000000000';
const inputPhoneNumberSpaced = '+1 000 000 00 00';
const inputPhoneNumberPunctuated = '+1-000-000-00-00';
const inputOtherPhoneNumber = '+19999999999';
const inputCallerKey = 'fake-api-key-one';
const inputOtherCallerKey = 'fake-api-key-two';

function createMockReflector(isPhoneRateLimited?: boolean): MockReflector {
  return { getAllAndOverride: jest.fn().mockReturnValue(isPhoneRateLimited) };
}

function createMockContext(
  inputBody: InputRequestBody,
  inputApiKey: string = inputCallerKey,
): MockContext {
  const mockHandler = function handler(): void {};
  class MockController {}
  const mockResponse: MockResponse = { setHeader: jest.fn() };
  const mockRequest = { headers: { [API_KEY_HEADER]: inputApiKey }, body: inputBody };

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

function createGuard(mockReflector: MockReflector): PhoneRateLimitGuard {
  return new PhoneRateLimitGuard(mockReflector as unknown as Reflector);
}

function activateTimes(
  guard: PhoneRateLimitGuard,
  inputBody: InputRequestBody,
  times: number,
  inputApiKey: string = inputCallerKey,
): boolean[] {
  const results: boolean[] = [];
  for (let attempt = 0; attempt < times; attempt += 1) {
    results.push(guard.canActivate(createMockContext(inputBody, inputApiKey).context));
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

describe('PhoneRateLimitGuard', () => {
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

  it('reads the marker metadata from the handler and the class', () => {
    const mockReflector = createMockReflector(true);
    const mockContext = createMockContext({ phoneNumber: inputPhoneNumber });

    createGuard(mockReflector).canActivate(mockContext.context);

    expect(mockReflector.getAllAndOverride).toHaveBeenCalledWith(IS_PHONE_RATE_LIMITED_KEY, [
      mockContext.context.getHandler(),
      mockContext.context.getClass(),
    ]);
  });

  it('allows an unmarked route however often the same number is sent', () => {
    const inputGuard = createGuard(createMockReflector(undefined));

    const actualResults = activateTimes(
      inputGuard,
      { phoneNumber: inputPhoneNumber },
      RATE_LIMIT_AUTH_MAX_REQUESTS + 1,
    );

    expect(actualResults.every((actualResult) => actualResult === true)).toBe(true);
  });

  it('counts nothing on an unmarked route, so the marked budget stays full', () => {
    const mockReflector = createMockReflector(undefined);
    const inputGuard = createGuard(mockReflector);
    activateTimes(inputGuard, { phoneNumber: inputPhoneNumber }, RATE_LIMIT_AUTH_MAX_REQUESTS + 1);

    mockReflector.getAllAndOverride.mockReturnValue(true);
    const actualResults = activateTimes(
      inputGuard,
      { phoneNumber: inputPhoneNumber },
      RATE_LIMIT_AUTH_MAX_REQUESTS,
    );

    expect(actualResults.every((actualResult) => actualResult === true)).toBe(true);
  });

  it('allows the configured number of auth requests for one phone number', () => {
    const inputGuard = createGuard(createMockReflector(true));

    const actualResults = activateTimes(
      inputGuard,
      { phoneNumber: inputPhoneNumber },
      RATE_LIMIT_AUTH_MAX_REQUESTS,
    );

    expect(actualResults).toHaveLength(RATE_LIMIT_AUTH_MAX_REQUESTS);
    expect(actualResults.every((actualResult) => actualResult === true)).toBe(true);
  });

  it('rejects the next auth request for that number with a 429 and a Retry-After header', () => {
    const inputGuard = createGuard(createMockReflector(true));
    activateTimes(inputGuard, { phoneNumber: inputPhoneNumber }, RATE_LIMIT_AUTH_MAX_REQUESTS);
    const mockContext = createMockContext({ phoneNumber: inputPhoneNumber });
    let actualError: TooManyRequestsException | undefined;

    try {
      inputGuard.canActivate(mockContext.context);
    } catch (caughtError) {
      actualError = caughtError as TooManyRequestsException;
    }

    expect(actualError).toBeInstanceOf(TooManyRequestsException);
    expect(actualError?.getStatus()).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(mockContext.mockResponse.setHeader).toHaveBeenCalledWith(
      RETRY_AFTER_HEADER,
      expect.any(Number),
    );
  });

  it('still serves a different phone number once one is exhausted', () => {
    const inputGuard = createGuard(createMockReflector(true));
    activateTimes(inputGuard, { phoneNumber: inputPhoneNumber }, RATE_LIMIT_AUTH_MAX_REQUESTS);

    expect(() =>
      inputGuard.canActivate(createMockContext({ phoneNumber: inputPhoneNumber }).context),
    ).toThrow(TooManyRequestsException);
    const actualOtherResult = inputGuard.canActivate(
      createMockContext({ phoneNumber: inputOtherPhoneNumber }).context,
    );

    expect(actualOtherResult).toBe(true);
  });

  it('shares one counter across caller keys, because the limit is per number', () => {
    const inputGuard = createGuard(createMockReflector(true));
    activateTimes(
      inputGuard,
      { phoneNumber: inputPhoneNumber },
      RATE_LIMIT_AUTH_MAX_REQUESTS,
      inputCallerKey,
    );

    expect(() =>
      inputGuard.canActivate(
        createMockContext({ phoneNumber: inputPhoneNumber }, inputOtherCallerKey).context,
      ),
    ).toThrow(TooManyRequestsException);
  });

  it('counts a number with surrounding whitespace as the same number', () => {
    const inputGuard = createGuard(createMockReflector(true));
    activateTimes(inputGuard, { phoneNumber: inputPhoneNumber }, RATE_LIMIT_AUTH_MAX_REQUESTS);

    expect(() =>
      inputGuard.canActivate(createMockContext({ phoneNumber: `  ${inputPhoneNumber}  ` }).context),
    ).toThrow(TooManyRequestsException);
  });

  it('counts the same digits as one number whatever formatting the caller sends', () => {
    const inputGuard = createGuard(createMockReflector(true));
    const inputFormats: InputRequestBody[] = [
      { phoneNumber: inputPhoneNumber },
      { phoneNumber: inputPhoneNumberWithoutPlus },
      { phoneNumber: inputPhoneNumberSpaced },
      { phoneNumber: inputPhoneNumberPunctuated },
      { phoneNumber: `  ${inputPhoneNumberSpaced}  ` },
    ];

    // One format per unit of budget: sharing a counter means the next call is refused.
    const actualResults = inputFormats.map((inputBody) =>
      inputGuard.canActivate(createMockContext(inputBody).context),
    );

    expect(inputFormats).toHaveLength(RATE_LIMIT_AUTH_MAX_REQUESTS);
    expect(actualResults.every((actualResult) => actualResult === true)).toBe(true);
    expect(() =>
      inputGuard.canActivate(createMockContext({ phoneNumber: inputPhoneNumber }).context),
    ).toThrow(TooManyRequestsException);
  });

  it('rejects a number sent without a plus once the plus-prefixed form is exhausted', () => {
    const inputGuard = createGuard(createMockReflector(true));
    activateTimes(inputGuard, { phoneNumber: inputPhoneNumber }, RATE_LIMIT_AUTH_MAX_REQUESTS);

    expect(() =>
      inputGuard.canActivate(
        createMockContext({ phoneNumber: inputPhoneNumberWithoutPlus }).context,
      ),
    ).toThrow(TooManyRequestsException);
  });

  it('keeps a differently numbered caller unaffected by the normalization', () => {
    const inputGuard = createGuard(createMockReflector(true));
    activateTimes(
      inputGuard,
      { phoneNumber: inputPhoneNumberSpaced },
      RATE_LIMIT_AUTH_MAX_REQUESTS,
    );

    const actualOtherResult = inputGuard.canActivate(
      createMockContext({ phoneNumber: inputOtherPhoneNumber }).context,
    );

    expect(actualOtherResult).toBe(true);
  });

  it('lets a request with an unusable phone number through to DTO validation', () => {
    const inputGuard = createGuard(createMockReflector(true));
    const inputBodies: InputRequestBody[] = [
      {},
      { phoneNumber: '' },
      { phoneNumber: '   ' },
      { phoneNumber: '+' },
      { phoneNumber: '+-() ' },
      { phoneNumber: 'not-a-number' },
      { phoneNumber: 1 },
      { phoneNumber: null },
      { phoneNumber: { value: inputPhoneNumber } },
      undefined,
      null,
      'not-an-object',
    ];

    const actualResults = inputBodies.map((inputBody) =>
      inputGuard.canActivate(createMockContext(inputBody).context),
    );

    const expectedResults = inputBodies.map(() => true);
    expect(actualResults).toEqual(expectedResults);
  });

  it('does not count a request with no usable number against the budget', () => {
    const inputGuard = createGuard(createMockReflector(true));
    for (let attempt = 0; attempt < RATE_LIMIT_AUTH_MAX_REQUESTS + 1; attempt += 1) {
      inputGuard.canActivate(createMockContext({}).context);
    }

    const actualResults = activateTimes(
      inputGuard,
      { phoneNumber: inputPhoneNumber },
      RATE_LIMIT_AUTH_MAX_REQUESTS,
    );

    expect(actualResults.every((actualResult) => actualResult === true)).toBe(true);
  });

  it('does not count a digit-free phoneNumber against the budget', () => {
    const inputGuard = createGuard(createMockReflector(true));

    const actualDigitFreeResults = activateTimes(
      inputGuard,
      { phoneNumber: 'not-a-number' },
      RATE_LIMIT_AUTH_MAX_REQUESTS + 1,
    );
    const actualResults = activateTimes(
      inputGuard,
      { phoneNumber: inputPhoneNumber },
      RATE_LIMIT_AUTH_MAX_REQUESTS,
    );

    expect(actualDigitFreeResults.every((actualResult) => actualResult === true)).toBe(true);
    expect(actualResults.every((actualResult) => actualResult === true)).toBe(true);
  });

  it('does not let two distinct digit-free strings collide on one counter', () => {
    const inputGuard = createGuard(createMockReflector(true));
    activateTimes(inputGuard, { phoneNumber: 'not-a-number' }, RATE_LIMIT_AUTH_MAX_REQUESTS + 1);

    const actualResult = inputGuard.canActivate(
      createMockContext({ phoneNumber: 'also-not-a-number' }).context,
    );

    expect(actualResult).toBe(true);
  });

  it('passes no phone number and no caller key to any logger level', () => {
    const inputGuard = createGuard(createMockReflector(true));
    activateTimes(inputGuard, { phoneNumber: inputPhoneNumber }, RATE_LIMIT_AUTH_MAX_REQUESTS);

    expect(() =>
      inputGuard.canActivate(createMockContext({ phoneNumber: inputPhoneNumber }).context),
    ).toThrow(TooManyRequestsException);

    const actualLoggedArguments = readLoggedArguments();
    expect(actualLoggedArguments).not.toContain(inputPhoneNumber);
    expect(actualLoggedArguments).not.toContain(inputCallerKey);
  });

  it('keeps the phone number out of the rejection the caller receives', () => {
    const inputGuard = createGuard(createMockReflector(true));
    activateTimes(inputGuard, { phoneNumber: inputPhoneNumber }, RATE_LIMIT_AUTH_MAX_REQUESTS);
    let actualError: TooManyRequestsException | undefined;

    try {
      inputGuard.canActivate(createMockContext({ phoneNumber: inputPhoneNumber }).context);
    } catch (caughtError) {
      actualError = caughtError as TooManyRequestsException;
    }

    const actualSerializedError = JSON.stringify({
      body: actualError?.getResponse(),
      message: actualError?.message,
    });
    expect(actualSerializedError).not.toContain(inputPhoneNumber);
  });
});
