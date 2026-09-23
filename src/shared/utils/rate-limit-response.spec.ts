import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { MS_IN_SECOND } from '../constants/rate-limit.constants';
import {
  RETRY_AFTER_HEADER,
  TOO_MANY_REQUESTS_MESSAGE,
  TooManyRequestsException,
  toRetryAfterSeconds,
} from '../exceptions/too-many-requests.exception';
import { rejectWithRetryAfter } from './rate-limit-response';

const HTTP_TOO_MANY_REQUESTS = 429;
const INPUT_RETRY_AFTER_SECONDS = 7;

type MockResponse = { setHeader: jest.Mock };

function createMockResponse(): MockResponse {
  return { setHeader: jest.fn() };
}

function callRejectWithRetryAfter(
  mockResponse: MockResponse,
  inputRetryAfterMs: number,
): TooManyRequestsException | undefined {
  try {
    rejectWithRetryAfter(mockResponse as unknown as Response, inputRetryAfterMs);
  } catch (caughtError) {
    return caughtError as TooManyRequestsException;
  }

  return undefined;
}

describe('toRetryAfterSeconds', () => {
  it('reports a whole-second wait unchanged', () => {
    const inputRetryAfterMs = INPUT_RETRY_AFTER_SECONDS * MS_IN_SECOND;

    const actualSeconds = toRetryAfterSeconds(inputRetryAfterMs);

    expect(actualSeconds).toBe(INPUT_RETRY_AFTER_SECONDS);
  });

  it('rounds a partial second up, so the caller never retries too early', () => {
    const inputRetryAfterMs = INPUT_RETRY_AFTER_SECONDS * MS_IN_SECOND + 1;

    const actualSeconds = toRetryAfterSeconds(inputRetryAfterMs);

    expect(actualSeconds).toBe(INPUT_RETRY_AFTER_SECONDS + 1);
  });

  it('rounds any remaining time up to at least one second', () => {
    const actualSeconds = toRetryAfterSeconds(1);

    expect(actualSeconds).toBe(1);
  });

  it('reports no wait for a zero remainder', () => {
    const actualSeconds = toRetryAfterSeconds(0);

    expect(actualSeconds).toBe(0);
  });
});

describe('TooManyRequestsException', () => {
  it('carries the 429 status', () => {
    const actualException = new TooManyRequestsException(INPUT_RETRY_AFTER_SECONDS);

    expect(actualException.getStatus()).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(actualException.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('carries the wait and the shared message in the response body', () => {
    const actualException = new TooManyRequestsException(INPUT_RETRY_AFTER_SECONDS);

    expect(actualException.getResponse()).toEqual({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: TOO_MANY_REQUESTS_MESSAGE,
      retryAfterSeconds: INPUT_RETRY_AFTER_SECONDS,
    });
  });

  it('exposes the wait as a property for callers that do not parse the body', () => {
    const actualException = new TooManyRequestsException(INPUT_RETRY_AFTER_SECONDS);

    expect(actualException.retryAfterSeconds).toBe(INPUT_RETRY_AFTER_SECONDS);
  });
});

describe('rejectWithRetryAfter', () => {
  it('sets the Retry-After header with the wait in whole seconds', () => {
    const mockResponse = createMockResponse();
    const inputRetryAfterMs = INPUT_RETRY_AFTER_SECONDS * MS_IN_SECOND;

    callRejectWithRetryAfter(mockResponse, inputRetryAfterMs);

    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      RETRY_AFTER_HEADER,
      INPUT_RETRY_AFTER_SECONDS,
    );
  });

  it('rounds the header value up, matching the body', () => {
    const mockResponse = createMockResponse();
    const inputRetryAfterMs = INPUT_RETRY_AFTER_SECONDS * MS_IN_SECOND + 1;

    const actualException = callRejectWithRetryAfter(mockResponse, inputRetryAfterMs);

    const expectedSeconds = INPUT_RETRY_AFTER_SECONDS + 1;
    expect(mockResponse.setHeader).toHaveBeenCalledWith(RETRY_AFTER_HEADER, expectedSeconds);
    expect(actualException?.retryAfterSeconds).toBe(expectedSeconds);
  });

  it('always throws a 429 carrying the wait', () => {
    const mockResponse = createMockResponse();
    const inputRetryAfterMs = INPUT_RETRY_AFTER_SECONDS * MS_IN_SECOND;

    const actualException = callRejectWithRetryAfter(mockResponse, inputRetryAfterMs);

    expect(actualException).toBeInstanceOf(TooManyRequestsException);
    expect(actualException?.getStatus()).toBe(HTTP_TOO_MANY_REQUESTS);
    expect(actualException?.getResponse()).toEqual({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: TOO_MANY_REQUESTS_MESSAGE,
      retryAfterSeconds: INPUT_RETRY_AFTER_SECONDS,
    });
  });

  it('sets the header before throwing, so the rejected response still carries it', () => {
    const mockResponse = createMockResponse();

    expect(() => rejectWithRetryAfter(mockResponse as unknown as Response, MS_IN_SECOND)).toThrow(
      TooManyRequestsException,
    );
    expect(mockResponse.setHeader).toHaveBeenCalledTimes(1);
  });
});
