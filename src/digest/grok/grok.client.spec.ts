import { Logger } from '@nestjs/common';
import type { DigestConfig } from '../../config/digest.config';
import {
  GROK_CALL_TIMEOUT_MS,
  GROK_CHAT_COMPLETIONS_URL,
  GROK_MAX_RETRIES,
  GROK_RETRY_BASE_DELAY_MS,
} from '../constants';
import { GrokClient, GrokError } from './grok.client';
import type { GrokJsonRequest } from './grok.client';

interface FakeAnswer {
  value: string;
}

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_TOO_MANY = 429;
const HTTP_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 503;
const TOTAL_ATTEMPTS = GROK_MAX_RETRIES + 1;
/** Enough fake time to run every retry wait and every call timeout. */
const ALL_WAITS_MS =
  TOTAL_ATTEMPTS * (GROK_CALL_TIMEOUT_MS + TOTAL_ATTEMPTS * GROK_RETRY_BASE_DELAY_MS);
/** Sum of every retry wait, (1 + 2 + ... + GROK_MAX_RETRIES) times the base delay. */
const RETRY_WAITS_MS = ((GROK_MAX_RETRIES * TOTAL_ATTEMPTS) / 2) * GROK_RETRY_BASE_DELAY_MS;

const inputApiKey = 'fake-grok-api-key';
const inputModel = 'fake-grok-model';
const inputSystem = 'fake system prompt SECRET-SYSTEM';
const inputUser = 'fake private post text SECRET-USER';
const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;

const mockConfig: DigestConfig = {
  channels: ['fake_channel'],
  cron: '0 23 * * *',
  timezone: 'Europe/Kyiv',
  grokApiKey: inputApiKey,
  grokModel: inputModel,
  grokReasoningEffort: 'low',
  botToken: 'fake-bot-token',
  botChatId: 'fake-chat-id',
  isConfigured: true,
};

function isFakeAnswer(value: unknown): value is FakeAnswer {
  return (
    typeof value === 'object' && value !== null && typeof (value as FakeAnswer).value === 'string'
  );
}

function buildRequest(): GrokJsonRequest<FakeAnswer> {
  return {
    system: inputSystem,
    user: inputUser,
    schemaName: 'fake_schema',
    schema: { type: 'object' },
    isValid: isFakeAnswer,
  };
}

function jsonResponse(body: unknown, status = HTTP_OK): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function contentResponse(content: unknown): Response {
  return jsonResponse({ choices: [{ message: { content } }] });
}

function abortError(): Error {
  return Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
}

/** A fetch that never answers on its own and rejects like real fetch once the signal aborts. */
function hangUntilAborted(_url: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(abortError()));
  });
}

describe('GrokClient', () => {
  let fetchSpy: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;
  let loggerSpies: jest.SpyInstance[];
  let client: GrokClient;

  function loggedText(): string {
    return loggerSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => String(arg))
      .join('\n');
  }

  function logCallCount(): number {
    return loggerSpies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
  }

  /** Starts a call, runs all fake time, and returns the settled value or error. */
  async function settle(): Promise<{ value?: FakeAnswer; error?: unknown }> {
    const outcome = client.completeJson(buildRequest()).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await jest.advanceTimersByTimeAsync(ALL_WAITS_MS);
    return outcome;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    fetchSpy = jest.spyOn(global, 'fetch');
    loggerSpies = LOGGER_LEVELS.map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    client = new GrokClient(mockConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('request', () => {
    it('posts a strict json_schema request with the bearer key and configured model', async () => {
      // Arrange
      fetchSpy.mockResolvedValueOnce(contentResponse(JSON.stringify({ value: 'ok' })));

      // Act
      await settle();

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [actualUrl, actualInit] = fetchSpy.mock.calls[0];
      expect(actualUrl).toBe(GROK_CHAT_COMPLETIONS_URL);
      expect(actualInit?.method).toBe('POST');
      expect(actualInit?.headers).toEqual({
        Authorization: `Bearer ${inputApiKey}`,
        'Content-Type': 'application/json',
      });
      expect(actualInit?.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(String(actualInit?.body))).toEqual({
        model: inputModel,
        reasoning_effort: 'low',
        stream: false,
        messages: [
          { role: 'system', content: inputSystem },
          { role: 'user', content: inputUser },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'fake_schema', schema: { type: 'object' }, strict: true },
        },
      });
    });

    it.each(['low', 'medium', 'high', 'xhigh'] as const)(
      'sends reasoning_effort=%s when that effort is configured',
      async (inputEffort) => {
        // Arrange
        client = new GrokClient({ ...mockConfig, grokReasoningEffort: inputEffort });
        fetchSpy.mockResolvedValueOnce(contentResponse(JSON.stringify({ value: 'ok' })));

        // Act
        await settle();

        // Assert
        const actualBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
        expect(actualBody.reasoning_effort).toBe(inputEffort);
      },
    );

    it('omits reasoning_effort entirely when the effort is off', async () => {
      // Arrange
      client = new GrokClient({ ...mockConfig, grokReasoningEffort: 'off' });
      fetchSpy.mockResolvedValueOnce(contentResponse(JSON.stringify({ value: 'ok' })));

      // Act
      await settle();

      // Assert
      const actualBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
      expect(actualBody).not.toHaveProperty('reasoning_effort');
      expect(actualBody.model).toBe(inputModel);
    });
  });

  describe('success', () => {
    it('returns the parsed answer without logging', async () => {
      // Arrange
      fetchSpy.mockResolvedValueOnce(contentResponse(JSON.stringify({ value: 'fake answer' })));

      // Act
      const actual = await settle();

      // Assert
      expect(actual.value).toEqual({ value: 'fake answer' });
      expect(logCallCount()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('retries', () => {
    it('retries a 429 after the base delay and returns the next answer', async () => {
      // Arrange
      fetchSpy
        .mockResolvedValueOnce(jsonResponse({}, HTTP_TOO_MANY))
        .mockResolvedValueOnce(contentResponse(JSON.stringify({ value: 'second' })));
      const outcome = client.completeJson(buildRequest());

      // Act
      await jest.advanceTimersByTimeAsync(GROK_RETRY_BASE_DELAY_MS - 1);
      const actualCallsBeforeDelay = fetchSpy.mock.calls.length;
      await jest.advanceTimersByTimeAsync(1);
      const actualValue = await outcome;

      // Assert
      expect(actualCallsBeforeDelay).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(actualValue).toEqual({ value: 'second' });
      expect(logCallCount()).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('waits (attempt + 1) times the base delay before each retry', async () => {
      // Arrange
      fetchSpy.mockImplementation(async () => jsonResponse({}, HTTP_SERVER_ERROR));
      const outcome = client.completeJson(buildRequest()).catch((error: unknown) => error);

      // Act
      await jest.advanceTimersByTimeAsync(0);
      const actualAfterFirst = fetchSpy.mock.calls.length;
      await jest.advanceTimersByTimeAsync(GROK_RETRY_BASE_DELAY_MS);
      const actualAfterFirstWait = fetchSpy.mock.calls.length;
      await jest.advanceTimersByTimeAsync(2 * GROK_RETRY_BASE_DELAY_MS - 1);
      const actualBeforeSecondWaitEnds = fetchSpy.mock.calls.length;
      await jest.advanceTimersByTimeAsync(1);
      await outcome;

      // Assert
      expect(actualAfterFirst).toBe(1);
      expect(actualAfterFirstWait).toBe(2);
      expect(actualBeforeSecondWaitEnds).toBe(2);
      expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
    });

    it.each([HTTP_SERVER_ERROR, HTTP_BAD_GATEWAY])(
      'gives up on %i after GROK_MAX_RETRIES retries with one error log line',
      async (inputStatus) => {
        // Arrange
        fetchSpy.mockImplementation(async () => jsonResponse({}, inputStatus));

        // Act
        const actual = await settle();

        // Assert
        expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
        expect(actual.error).toBeInstanceOf(GrokError);
        expect((actual.error as GrokError).message).toBe(`HTTP ${inputStatus}`);
        expect((actual.error as GrokError).isRetryable).toBe(true);
        expect(logCallCount()).toBe(1);
        expect(loggerSpies[LOGGER_LEVELS.indexOf('error')]).toHaveBeenCalledWith(
          `Grok fake_schema failed: HTTP ${inputStatus}`,
        );
        expect(jest.getTimerCount()).toBe(0);
      },
    );

    it.each([HTTP_BAD_REQUEST, HTTP_UNAUTHORIZED])(
      'does not retry a %i and throws a non-retryable error',
      async (inputStatus) => {
        // Arrange
        fetchSpy.mockResolvedValue(jsonResponse({}, inputStatus));

        // Act
        const actual = await settle();

        // Assert
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(actual.error).toBeInstanceOf(GrokError);
        expect((actual.error as GrokError).message).toBe(`HTTP ${inputStatus}`);
        expect((actual.error as GrokError).isRetryable).toBe(false);
        expect(logCallCount()).toBe(1);
        expect(jest.getTimerCount()).toBe(0);
      },
    );

    it.each([
      [
        'a network error',
        () => Promise.reject(new TypeError('fetch failed')),
        'network error (TypeError)',
      ],
      ['a non-Error rejection', () => Promise.reject('boom'), 'network error (unknown)'],
      [
        'an answer without content',
        async () => jsonResponse({ choices: [] }),
        'answer has no content',
      ],
      [
        'a non-string content',
        async () => contentResponse({ value: 'x' }),
        'answer has no content',
      ],
      [
        'invalid JSON content',
        async () => contentResponse('{not json'),
        'answer is not valid JSON',
      ],
      [
        'a schema mismatch',
        async () => contentResponse(JSON.stringify({ other: 1 })),
        'answer does not match the schema',
      ],
    ])('retries %s and then succeeds', async (_name, inputFailure) => {
      // Arrange
      fetchSpy
        .mockImplementationOnce(inputFailure as () => Promise<Response>)
        .mockResolvedValueOnce(contentResponse(JSON.stringify({ value: 'recovered' })));

      // Act
      const actual = await settle();

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(actual.value).toEqual({ value: 'recovered' });
      expect(jest.getTimerCount()).toBe(0);
    });

    it.each([
      [
        'a network error',
        () => Promise.reject(new TypeError('fetch failed')),
        'network error (TypeError)',
      ],
      ['a non-Error rejection', () => Promise.reject('boom'), 'network error (unknown)'],
      [
        'an answer without content',
        async () => jsonResponse({ choices: [] }),
        'answer has no content',
      ],
      [
        'invalid JSON content',
        async () => contentResponse('{not json'),
        'answer is not valid JSON',
      ],
      [
        'a schema mismatch',
        async () => contentResponse(JSON.stringify({ other: 1 })),
        'answer does not match the schema',
      ],
    ])('gives up on %s after all attempts', async (_name, inputFailure, expectedMessage) => {
      // Arrange
      fetchSpy.mockImplementation(inputFailure as () => Promise<Response>);

      // Act
      const actual = await settle();

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
      expect(actual.error).toBeInstanceOf(GrokError);
      expect((actual.error as GrokError).message).toBe(expectedMessage);
      expect(logCallCount()).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('timeout', () => {
    it('aborts a call that takes longer than GROK_CALL_TIMEOUT_MS and retries it', async () => {
      // Arrange
      fetchSpy
        .mockImplementationOnce(hangUntilAborted)
        .mockResolvedValueOnce(contentResponse(JSON.stringify({ value: 'after timeout' })));
      const outcome = client.completeJson(buildRequest());

      // Act
      await jest.advanceTimersByTimeAsync(GROK_CALL_TIMEOUT_MS - 1);
      const actualCallsBeforeTimeout = fetchSpy.mock.calls.length;
      const actualSignal = fetchSpy.mock.calls[0][1]?.signal;
      const actualAbortedEarly = actualSignal?.aborted;
      await jest.advanceTimersByTimeAsync(1 + GROK_RETRY_BASE_DELAY_MS);
      const actualValue = await outcome;

      // Assert
      expect(actualCallsBeforeTimeout).toBe(1);
      expect(actualAbortedEarly).toBe(false);
      expect(actualSignal?.aborted).toBe(true);
      expect(actualValue).toEqual({ value: 'after timeout' });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('throws a retryable timeout error when every attempt times out', async () => {
      // Arrange
      fetchSpy.mockImplementation(hangUntilAborted);

      // Act
      const actual = await settle();

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
      expect(actual.error).toBeInstanceOf(GrokError);
      expect((actual.error as GrokError).message).toBe('timeout');
      expect((actual.error as GrokError).isRetryable).toBe(true);
      expect(logCallCount()).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('keeps the timeout armed while the body is parsed', async () => {
      // Arrange
      let capturedSignal: AbortSignal | undefined;
      fetchSpy.mockImplementation(async (_url, init) => {
        capturedSignal = init?.signal ?? undefined;
        return {
          ok: true,
          status: HTTP_OK,
          json: () =>
            new Promise((_resolve, reject) => {
              capturedSignal?.addEventListener('abort', () => reject(abortError()));
            }),
        } as unknown as Response;
      });

      // Act
      const actual = await settle();

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
      expect((actual.error as GrokError).message).toBe('timeout');
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('timer hygiene', () => {
    /**
     * Only the retry waits are run, never GROK_CALL_TIMEOUT_MS: a call timeout that was not
     * cleared would still be pending here and show up in jest.getTimerCount().
     */
    it.each([
      ['success', async () => contentResponse(JSON.stringify({ value: 'ok' }))],
      ['non-retryable HTTP error', async () => jsonResponse({}, HTTP_BAD_REQUEST)],
      ['retryable HTTP error', async () => jsonResponse({}, HTTP_TOO_MANY)],
      ['invalid JSON', async () => contentResponse('not json at all')],
      ['network error', () => Promise.reject(new TypeError('fetch failed'))],
    ])('leaves no pending timer after %s settles', async (_name, inputFetch) => {
      // Arrange
      fetchSpy.mockImplementation(inputFetch as typeof fetch);
      let isSettled = false;
      const outcome = client
        .completeJson(buildRequest())
        .catch(() => undefined)
        .finally(() => {
          isSettled = true;
        });

      // Act
      await jest.advanceTimersByTimeAsync(RETRY_WAITS_MS);

      // Assert
      expect(isSettled).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
      await outcome;
    });

    it.each([
      ['success', async () => contentResponse(JSON.stringify({ value: 'ok' }))],
      ['HTTP error', async () => jsonResponse({}, HTTP_SERVER_ERROR)],
      ['abort', hangUntilAborted],
      ['invalid JSON', async () => contentResponse('not json at all')],
    ])('clears every call timeout it armed on %s', async (_name, inputFetch) => {
      // Arrange
      fetchSpy.mockImplementation(inputFetch as typeof fetch);
      const setSpy = jest.spyOn(global, 'setTimeout');
      const clearSpy = jest.spyOn(global, 'clearTimeout');

      // Act
      await settle();

      // Assert
      const actualCallTimers = setSpy.mock.results
        .filter((_result, index) => setSpy.mock.calls[index][1] === GROK_CALL_TIMEOUT_MS)
        .map((result) => result.value as unknown);
      const actualCleared = clearSpy.mock.calls.map(([id]) => id as unknown);
      expect(actualCallTimers).toHaveLength(fetchSpy.mock.calls.length);
      for (const timer of actualCallTimers) {
        expect(actualCleared).toContain(timer);
      }
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('secret hygiene', () => {
    it.each([
      ['HTTP error', async () => jsonResponse({ error: inputApiKey }, HTTP_UNAUTHORIZED)],
      [
        'network error carrying the key',
        () => Promise.reject(new Error(`failed ${inputApiKey} ${inputUser}`)),
      ],
      [
        'invalid JSON echoing the prompt',
        async () => contentResponse(`${inputUser} ${inputApiKey}`),
      ],
      ['timeout', hangUntilAborted],
    ])(
      'never puts the key or the prompt into the error or the log on %s',
      async (_name, inputFetch) => {
        // Arrange
        fetchSpy.mockImplementation(inputFetch as typeof fetch);

        // Act
        const actual = await settle();

        // Assert
        const actualMessage = String((actual.error as Error).message);
        const actualLogs = loggedText();
        for (const secret of [
          inputApiKey,
          inputUser,
          inputSystem,
          'SECRET-USER',
          'SECRET-SYSTEM',
        ]) {
          expect(actualMessage).not.toContain(secret);
          expect(actualLogs).not.toContain(secret);
        }
        expect(actualLogs.length).toBeGreaterThan(0);
      },
    );
  });
});
