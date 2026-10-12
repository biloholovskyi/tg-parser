import { AlertSendError, sendAlert } from './alert-sender';
import type { AlertTarget } from './alert-sender';
import {
  ALERTS_INGEST_PATH,
  ALERT_CALL_TIMEOUT_MS,
  ALERT_MAX_RETRIES,
  ALERT_RETRY_DELAY_MS,
} from './constants';
import type { AlertPayload } from './interfaces/alert.interface';

const HTTP_ACCEPTED = 202;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVICE_UNAVAILABLE = 503;
const TOTAL_ATTEMPTS = 1 + ALERT_MAX_RETRIES;

const mockTarget: AlertTarget = { url: 'https://alerts.example.test', apiKey: 'test-alert-key' };
const inputPayload: AlertPayload = {
  serviceName: 'fake-service',
  level: 'error',
  message: 'fake failure',
  details: { attempt: 1 },
};

function statusResponse(status: number): Response {
  return new Response(null, { status });
}

function abortError(): Error {
  return Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
}

/** A fetch that never answers on its own and rejects like real fetch once its signal aborts. */
function hangUntilAborted(_url: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(abortError()));
  });
}

describe('sendAlert', () => {
  let fetchSpy: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;

  /** Starts the send and records how it settles, so fake time can run before awaiting. */
  function startSend(signal?: AbortSignal): Promise<unknown> {
    return sendAlert(mockTarget, inputPayload, signal).then(
      () => 'resolved',
      (error: unknown) => error,
    );
  }

  function expectSendError(actual: unknown, expectedMessage: string): void {
    expect(actual).toBeInstanceOf(AlertSendError);
    const actualError = actual as AlertSendError;
    expect(actualError.message).toBe(expectedMessage);
    expect(actualError.message).not.toContain(mockTarget.url);
    expect(actualError.message).not.toContain(mockTarget.apiKey);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('POSTs the payload to the ingest path with the API key header and resolves on 202', async () => {
    // Arrange
    fetchSpy.mockResolvedValue(statusResponse(HTTP_ACCEPTED));

    // Act
    const actualOutcome = await startSend();

    // Assert
    expect(actualOutcome).toBe('resolved');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [actualUrl, actualInit] = fetchSpy.mock.calls[0];
    expect(actualUrl).toBe(`${mockTarget.url}${ALERTS_INGEST_PATH}`);
    expect(actualInit?.method).toBe('POST');
    expect(actualInit?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-API-Key': mockTarget.apiKey,
    });
    expect(JSON.parse(actualInit?.body as string)).toEqual(inputPayload);
    expect(actualInit?.signal).toBeInstanceOf(AbortSignal);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retries once after ALERT_RETRY_DELAY_MS on 503 and then throws', async () => {
    // Arrange
    fetchSpy.mockImplementation(async () => statusResponse(HTTP_SERVICE_UNAVAILABLE));

    // Act
    const actualPromise = startSend();
    await jest.advanceTimersByTimeAsync(ALERT_RETRY_DELAY_MS - 1);
    const actualCallsBeforeDelay = fetchSpy.mock.calls.length;
    await jest.advanceTimersByTimeAsync(1);
    const actualOutcome = await actualPromise;

    // Assert
    expect(actualCallsBeforeDelay).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
    expectSendError(actualOutcome, `HTTP ${HTTP_SERVICE_UNAVAILABLE}`);
    expect((actualOutcome as AlertSendError).isRetryable).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resolves when the retry after a 503 succeeds', async () => {
    // Arrange
    fetchSpy
      .mockResolvedValueOnce(statusResponse(HTTP_SERVICE_UNAVAILABLE))
      .mockResolvedValueOnce(statusResponse(HTTP_ACCEPTED));

    // Act
    const actualPromise = startSend();
    await jest.advanceTimersByTimeAsync(ALERT_RETRY_DELAY_MS);
    const actualOutcome = await actualPromise;

    // Assert
    expect(actualOutcome).toBe('resolved');
    expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retries once on a network error and then throws without the URL or key', async () => {
    // Arrange
    fetchSpy.mockImplementation(async () => {
      throw new TypeError(`fetch failed for ${mockTarget.url} with ${mockTarget.apiKey}`);
    });

    // Act
    const actualPromise = startSend();
    await jest.advanceTimersByTimeAsync(ALERT_RETRY_DELAY_MS);
    const actualOutcome = await actualPromise;

    // Assert
    expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
    expectSendError(actualOutcome, 'network error (TypeError)');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports a non-Error rejection as an unknown network error', async () => {
    // Arrange
    fetchSpy.mockImplementation(() => Promise.reject('fake reason'));

    // Act
    const actualPromise = startSend();
    await jest.advanceTimersByTimeAsync(ALERT_RETRY_DELAY_MS);
    const actualOutcome = await actualPromise;

    // Assert
    expectSendError(actualOutcome, 'network error (unknown)');
  });

  it.each([HTTP_BAD_REQUEST, HTTP_UNAUTHORIZED])('does not retry on %s', async (inputStatus) => {
    // Arrange
    fetchSpy.mockImplementation(async () => statusResponse(inputStatus));

    // Act
    const actualOutcome = await startSend();

    // Assert
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expectSendError(actualOutcome, `HTTP ${inputStatus}`);
    expect((actualOutcome as AlertSendError).isRetryable).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts a call after ALERT_CALL_TIMEOUT_MS, retries it, and fails with "timeout"', async () => {
    // Arrange
    fetchSpy.mockImplementation(hangUntilAborted);

    // Act
    const actualPromise = startSend();
    await jest.advanceTimersByTimeAsync(ALERT_CALL_TIMEOUT_MS - 1);
    const actualSignal = fetchSpy.mock.calls[0][1]?.signal as AbortSignal;
    const actualAbortedEarly = actualSignal.aborted;
    await jest.advanceTimersByTimeAsync(1);
    const actualAbortedAtTimeout = actualSignal.aborted;
    await jest.advanceTimersByTimeAsync(ALERT_RETRY_DELAY_MS + ALERT_CALL_TIMEOUT_MS);
    const actualOutcome = await actualPromise;

    // Assert
    expect(actualAbortedEarly).toBe(false);
    expect(actualAbortedAtTimeout).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
    expectSendError(actualOutcome, 'timeout');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with "aborted" and makes no retry when the caller aborts a request', async () => {
    // Arrange
    fetchSpy.mockImplementation(hangUntilAborted);
    const inputController = new AbortController();

    // Act
    const actualPromise = startSend(inputController.signal);
    await jest.advanceTimersByTimeAsync(0);
    inputController.abort();
    const actualOutcome = await actualPromise;
    const actualTimersAfterSettle = jest.getTimerCount();
    await jest.advanceTimersByTimeAsync(ALERT_RETRY_DELAY_MS + ALERT_CALL_TIMEOUT_MS);

    // Assert
    expectSendError(actualOutcome, 'aborted');
    expect((actualOutcome as AlertSendError).isRetryable).toBe(false);
    expect(actualTimersAfterSettle).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects with "aborted" without calling fetch when the signal is already aborted', async () => {
    // Arrange
    fetchSpy.mockResolvedValue(statusResponse(HTTP_ACCEPTED));
    const inputController = new AbortController();
    inputController.abort();

    // Act
    const actualOutcome = await startSend(inputController.signal);

    // Assert
    expectSendError(actualOutcome, 'aborted');
    expect((actualOutcome as AlertSendError).isRetryable).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with "aborted" when the caller aborts during the retry wait', async () => {
    // Arrange
    fetchSpy.mockImplementation(async () => statusResponse(HTTP_SERVICE_UNAVAILABLE));
    const inputController = new AbortController();

    // Act
    const actualPromise = startSend(inputController.signal);
    await jest.advanceTimersByTimeAsync(ALERT_RETRY_DELAY_MS / 2);
    inputController.abort();
    const actualOutcome = await actualPromise;

    // Assert
    expectSendError(actualOutcome, 'aborted');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
