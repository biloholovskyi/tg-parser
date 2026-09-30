import { Logger } from '@nestjs/common';
import type { DigestConfig } from '../config/digest.config';
import { BotError, BotNotifier } from './bot-notifier';
import {
  BOT_API_BASE_URL,
  BOT_CALL_TIMEOUT_MS,
  BOT_MAX_RETRIES,
  BOT_MAX_RETRY_AFTER_S,
  BOT_RETRY_BASE_DELAY_MS,
} from './constants';

const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const INPUT_FAKE_TOKEN = 'fake-bot-token';
const INPUT_FAKE_CHAT_ID = '-100000';
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const MS_IN_SECOND = 1000;
const INPUT_RETRY_AFTER_S = 5;
const TOTAL_ATTEMPTS = 1 + BOT_MAX_RETRIES;
const LONG_DESCRIPTION_CHARS = 1000;
const MAX_DESCRIPTION_CHARS = 200;
/** Sum of every linear backoff wait, so a run of retries always settles. */
const ALL_BACKOFF_MS =
  (BOT_MAX_RETRIES * (BOT_MAX_RETRIES + 1) * BOT_RETRY_BASE_DELAY_MS) / 2 +
  TOTAL_ATTEMPTS * BOT_CALL_TIMEOUT_MS;

const mockConfig: DigestConfig = {
  channels: ['fake_channel'],
  cron: '0 23 * * *',
  timezone: 'Europe/Kyiv',
  grokApiKey: 'fake-grok-key',
  grokModel: 'fake-model',
  grokReasoningEffort: 'low',
  botToken: INPUT_FAKE_TOKEN,
  botChatId: INPUT_FAKE_CHAT_ID,
  isConfigured: true,
};

function jsonResponse(body: unknown, status = HTTP_OK): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function okResponse(): Response {
  return jsonResponse({ ok: true, result: {} });
}

function errorResponse(status: number, description: string, retryAfter?: number): Response {
  const parameters = retryAfter === undefined ? undefined : { retry_after: retryAfter };
  return jsonResponse({ ok: false, error_code: status, description, parameters }, status);
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

describe('BotNotifier', () => {
  let fetchSpy: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;
  let loggerSpies: jest.SpyInstance[];
  let notifier: BotNotifier;

  function loggedText(): string {
    return loggerSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => String(arg))
      .join('\n');
  }

  function sentTexts(): string[] {
    return fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).text as string);
  }

  /** Starts a send and returns its outcome without letting a rejection go unhandled. */
  function start(messages: string[]): Promise<{ error?: unknown }> {
    return notifier.send(messages).then(
      () => ({}),
      (error: unknown) => ({ error }),
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
    fetchSpy = jest.spyOn(global, 'fetch');
    loggerSpies = LOGGER_LEVELS.map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    notifier = new BotNotifier(mockConfig);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('request', () => {
    it('posts one sendMessage with chat id, HTML parse mode and link previews off', async () => {
      // Arrange
      fetchSpy.mockResolvedValueOnce(okResponse());

      // Act
      await notifier.send(['<b>hello</b>']);

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [actualUrl, actualInit] = fetchSpy.mock.calls[0];
      expect(actualUrl).toBe(`${BOT_API_BASE_URL}/bot${INPUT_FAKE_TOKEN}/sendMessage`);
      expect(actualInit?.method).toBe('POST');
      expect(actualInit?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(actualInit?.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(String(actualInit?.body))).toEqual({
        chat_id: INPUT_FAKE_CHAT_ID,
        text: '<b>hello</b>',
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    });

    it('clears the call timeout once the call settles', async () => {
      // Arrange
      fetchSpy.mockResolvedValueOnce(okResponse());

      // Act
      await notifier.send(['one']);

      // Assert
      expect(jest.getTimerCount()).toBe(0);
    });

    it('sends nothing for an empty list', async () => {
      // Act
      await notifier.send([]);

      // Assert
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends several messages strictly one after another, in order', async () => {
      // Arrange
      let resolveFirst: (response: Response) => void = () => undefined;
      fetchSpy
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockImplementation(async () => okResponse());
      const inputMessages = ['first', 'second', 'third'];

      // Act
      const actualOutcome = start(inputMessages);
      await jest.advanceTimersByTimeAsync(0);
      const actualCallsWhileFirstPending = fetchSpy.mock.calls.length;
      resolveFirst(okResponse());
      const actualResult = await actualOutcome;

      // Assert
      expect(actualCallsWhileFirstPending).toBe(1);
      expect(actualResult.error).toBeUndefined();
      expect(sentTexts()).toEqual(inputMessages);
    });

    it('treats a 200 answer with ok=false as a failure', async () => {
      // Arrange
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: false, description: 'fake refusal' }));

      // Act
      const actualResult = await start(['one']);

      // Assert
      expect(actualResult.error).toBeInstanceOf(BotError);
      expect((actualResult.error as BotError).message).toBe('HTTP 200 (fake refusal)');
    });
  });

  describe('429 Too Many Requests', () => {
    it('waits retry_after seconds and then sends again', async () => {
      // Arrange
      fetchSpy
        .mockResolvedValueOnce(
          errorResponse(HTTP_TOO_MANY_REQUESTS, 'Too Many Requests', INPUT_RETRY_AFTER_S),
        )
        .mockResolvedValueOnce(okResponse());

      // Act
      const actualOutcome = start(['one']);
      await jest.advanceTimersByTimeAsync(INPUT_RETRY_AFTER_S * MS_IN_SECOND - 1);
      const actualCallsBeforeWaitEnds = fetchSpy.mock.calls.length;
      await jest.advanceTimersByTimeAsync(1);
      const actualResult = await actualOutcome;

      // Assert
      expect(actualCallsBeforeWaitEnds).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(actualResult.error).toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('waits exactly BOT_MAX_RETRY_AFTER_S when retry_after equals the cap', async () => {
      // Arrange
      fetchSpy
        .mockResolvedValueOnce(
          errorResponse(HTTP_TOO_MANY_REQUESTS, 'Too Many Requests', BOT_MAX_RETRY_AFTER_S),
        )
        .mockResolvedValueOnce(okResponse());

      // Act
      const actualOutcome = start(['one']);
      await jest.advanceTimersByTimeAsync(BOT_MAX_RETRY_AFTER_S * MS_IN_SECOND);
      const actualResult = await actualOutcome;

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(actualResult.error).toBeUndefined();
    });

    it('does not wait for a retry_after above the cap and throws at once', async () => {
      // Arrange
      fetchSpy.mockResolvedValueOnce(
        errorResponse(HTTP_TOO_MANY_REQUESTS, 'Too Many Requests', BOT_MAX_RETRY_AFTER_S + 1),
      );

      // Act
      const actualResult = await start(['one']);

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(actualResult.error).toBeInstanceOf(BotError);
      expect((actualResult.error as BotError).message).toBe('HTTP 429 (Too Many Requests)');
      expect((actualResult.error as BotError).retryAfterS).toBe(BOT_MAX_RETRY_AFTER_S + 1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('waits one second when a 429 carries no retry_after', async () => {
      // Arrange
      fetchSpy
        .mockResolvedValueOnce(errorResponse(HTTP_TOO_MANY_REQUESTS, 'Too Many Requests'))
        .mockResolvedValueOnce(okResponse());

      // Act
      const actualOutcome = start(['one']);
      await jest.advanceTimersByTimeAsync(MS_IN_SECOND - 1);
      const actualCallsBeforeWaitEnds = fetchSpy.mock.calls.length;
      await jest.advanceTimersByTimeAsync(1);
      await actualOutcome;

      // Assert
      expect(actualCallsBeforeWaitEnds).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('transient failures', () => {
    it('retries a 5xx after the base delay and succeeds', async () => {
      // Arrange
      fetchSpy
        .mockResolvedValueOnce(errorResponse(HTTP_BAD_GATEWAY, 'Bad Gateway'))
        .mockResolvedValueOnce(okResponse());

      // Act
      const actualOutcome = start(['one']);
      await jest.advanceTimersByTimeAsync(BOT_RETRY_BASE_DELAY_MS - 1);
      const actualCallsBeforeDelay = fetchSpy.mock.calls.length;
      await jest.advanceTimersByTimeAsync(1);
      const actualResult = await actualOutcome;

      // Assert
      expect(actualCallsBeforeDelay).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(actualResult.error).toBeUndefined();
    });

    it('backs off linearly and gives up after BOT_MAX_RETRIES retries', async () => {
      // Arrange
      fetchSpy.mockImplementation(async () => errorResponse(HTTP_SERVER_ERROR, 'fake outage'));

      // Act
      const actualOutcome = start(['one']);
      await jest.advanceTimersByTimeAsync(0);
      const actualAfterFirst = fetchSpy.mock.calls.length;
      await jest.advanceTimersByTimeAsync(BOT_RETRY_BASE_DELAY_MS);
      const actualAfterFirstWait = fetchSpy.mock.calls.length;
      await jest.advanceTimersByTimeAsync(2 * BOT_RETRY_BASE_DELAY_MS - 1);
      const actualBeforeSecondWaitEnds = fetchSpy.mock.calls.length;
      await jest.advanceTimersByTimeAsync(ALL_BACKOFF_MS);
      const actualResult = await actualOutcome;

      // Assert
      expect(actualAfterFirst).toBe(1);
      expect(actualAfterFirstWait).toBe(2);
      expect(actualBeforeSecondWaitEnds).toBe(2);
      expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
      expect(actualResult.error).toBeInstanceOf(BotError);
      expect((actualResult.error as BotError).message).toBe('HTTP 500 (fake outage)');
    });

    it('retries after a call timeout and succeeds on the next attempt', async () => {
      // Arrange
      fetchSpy.mockImplementationOnce(hangUntilAborted).mockResolvedValueOnce(okResponse());

      // Act
      const actualOutcome = start(['one']);
      await jest.advanceTimersByTimeAsync(BOT_CALL_TIMEOUT_MS - 1);
      const actualCallsBeforeTimeout = fetchSpy.mock.calls.length;
      await jest.advanceTimersByTimeAsync(1 + BOT_RETRY_BASE_DELAY_MS);
      const actualResult = await actualOutcome;

      // Assert
      expect(actualCallsBeforeTimeout).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(actualResult.error).toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('reports "timeout" when every attempt times out', async () => {
      // Arrange
      fetchSpy.mockImplementation(hangUntilAborted);

      // Act
      const actualOutcome = start(['one']);
      await jest.advanceTimersByTimeAsync(ALL_BACKOFF_MS);
      const actualResult = await actualOutcome;

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
      expect((actualResult.error as BotError).message).toBe('timeout');
    });

    it('retries a network error and names only the error type when it persists', async () => {
      // Arrange
      fetchSpy.mockImplementation(async () => {
        throw new TypeError(
          `request to ${BOT_API_BASE_URL}/bot${INPUT_FAKE_TOKEN}/sendMessage failed`,
        );
      });

      // Act
      const actualOutcome = start(['one']);
      await jest.advanceTimersByTimeAsync(ALL_BACKOFF_MS);
      const actualResult = await actualOutcome;

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(TOTAL_ATTEMPTS);
      expect((actualResult.error as BotError).message).toBe('network error (TypeError)');
      expect((actualResult.error as BotError).isRetryable).toBe(true);
    });

    it('recovers from a network error on the next attempt', async () => {
      // Arrange
      fetchSpy
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(okResponse());

      // Act
      const actualOutcome = start(['one']);
      await jest.advanceTimersByTimeAsync(BOT_RETRY_BASE_DELAY_MS);
      const actualResult = await actualOutcome;

      // Assert
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(actualResult.error).toBeUndefined();
    });
  });

  describe('terminal failures', () => {
    it.each([HTTP_BAD_REQUEST, HTTP_FORBIDDEN])(
      'throws a %d at once without retry',
      async (inputStatus) => {
        // Arrange
        fetchSpy.mockResolvedValue(errorResponse(inputStatus, "Bad Request: can't parse entities"));

        // Act
        const actualResult = await start(['one']);

        // Assert
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(actualResult.error).toBeInstanceOf(BotError);
        expect((actualResult.error as BotError).isRetryable).toBe(false);
        expect((actualResult.error as BotError).message).toBe(
          `HTTP ${inputStatus} (Bad Request: can't parse entities)`,
        );
      },
    );

    it('carries only the status when the body is not JSON', async () => {
      // Arrange
      fetchSpy.mockResolvedValueOnce(new Response('not json', { status: HTTP_BAD_REQUEST }));

      // Act
      const actualResult = await start(['one']);

      // Assert
      expect((actualResult.error as BotError).message).toBe('HTTP 400');
    });

    it('truncates a long Telegram description', async () => {
      // Arrange
      fetchSpy.mockResolvedValueOnce(
        errorResponse(HTTP_BAD_REQUEST, 'd'.repeat(LONG_DESCRIPTION_CHARS)),
      );

      // Act
      const actualResult = await start(['one']);

      // Assert
      expect((actualResult.error as BotError).message).toBe(
        `HTTP 400 (${'d'.repeat(MAX_DESCRIPTION_CHARS)})`,
      );
    });

    it('stops at the first undeliverable message and sends none after it', async () => {
      // Arrange
      fetchSpy
        .mockResolvedValueOnce(okResponse())
        .mockResolvedValueOnce(errorResponse(HTTP_BAD_REQUEST, 'Bad Request'))
        .mockImplementation(async () => okResponse());

      // Act
      const actualResult = await start(['first', 'second', 'third']);

      // Assert
      expect(actualResult.error).toBeInstanceOf(BotError);
      expect(sentTexts()).toEqual(['first', 'second']);
    });
  });

  describe('secret hygiene', () => {
    it('never puts the token or the URL into an error or a log line', async () => {
      // Arrange
      const inputFailures: Array<(url: unknown, init?: RequestInit) => Promise<Response>> = [
        async () => errorResponse(HTTP_BAD_REQUEST, 'Bad Request'),
        async () => {
          throw new TypeError(`connect to ${BOT_API_BASE_URL}/bot${INPUT_FAKE_TOKEN} failed`);
        },
        hangUntilAborted,
      ];
      const actualErrors: unknown[] = [];

      // Act
      for (const failure of inputFailures) {
        fetchSpy.mockReset();
        fetchSpy.mockImplementation(failure);
        const outcome = start(['one']);
        await jest.advanceTimersByTimeAsync(ALL_BACKOFF_MS);
        actualErrors.push((await outcome).error);
      }

      // Assert
      for (const error of actualErrors) {
        const actualText = `${(error as Error).message} ${String(error)} ${JSON.stringify(error)}`;
        expect(actualText).not.toContain(INPUT_FAKE_TOKEN);
        expect(actualText).not.toContain(BOT_API_BASE_URL);
      }
      expect(loggedText()).not.toContain(INPUT_FAKE_TOKEN);
    });
  });
});
