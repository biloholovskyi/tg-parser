import {
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DigestConfig } from '../config/digest.config';
import type { BotNotifier } from './bot-notifier';
import { DIGEST_MAX_POSTS, DIGEST_WINDOW_HOURS } from './constants';
import {
  DIGEST_ALREADY_RUNNING_MESSAGE,
  DIGEST_NOT_CONFIGURED_MESSAGE,
  DigestService,
} from './digest.service';
import type { CollectedPosts, DigestPost } from './interfaces/digest-post.interface';
import type {
  SummaryResult,
  TranslatedPost,
  TranslationResult,
} from './interfaces/digest-topic.interface';
import type { PostCollector } from './post-collector';
import type { SummaryService } from './summary.service';
import type { TranslationService } from './translation.service';

/** The real collector imports the TelegramService facade, which loads GramJS. */
jest.mock('./post-collector', () => ({ PostCollector: class {} }));

const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const INPUT_FAKE_TOKEN = 'fake-bot-token';
const INPUT_CHANNELS = ['fake_alpha', 'fake_beta'];
const SECRET_ORIGINAL = 'SECRET-ORIGINAL-POST-BODY';
const SECRET_TRANSLATED = 'SECRET-TRANSLATED-POST-BODY';
const BASE_DATE_MS = Date.UTC(2026, 0, 1);
const FLUSH_ROUNDS = 20;
const EXTRA_POSTS = 5;
const SESSION_REASON = 'Сессия дайджеста не задана или отозвана';
const FLOOD_REASON = 'Telegram ограничил частоту запросов';
const UNAVAILABLE_REASON = 'Telegram или хранилище сессий недоступны';
const GENERIC_REASON = 'Внутренняя ошибка, подробности в логах сервиса.';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Lets a background run started by `start()` reach its end. */
async function flushBackground(): Promise<void> {
  for (let round = 0; round < FLUSH_ROUNDS; round++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function buildPost(index: number, hasText = true): DigestPost {
  return {
    ref: `p${index}`,
    channel: INPUT_CHANNELS[index % INPUT_CHANNELS.length],
    url: `https://t.me/${INPUT_CHANNELS[index % INPUT_CHANNELS.length]}/${index}`,
    text: hasText ? `${SECRET_ORIGINAL} ${index}` : '',
    date: new Date(BASE_DATE_MS + index),
    hasText,
  };
}

function buildCollected(posts: DigestPost[]): CollectedPosts {
  return {
    posts,
    channelCount: INPUT_CHANNELS.length,
    unavailableChannels: [],
    truncatedChannels: [],
  };
}

function translate(posts: DigestPost[]): TranslationResult {
  const translated: TranslatedPost[] = posts.map((post) => ({
    ...post,
    translated: post.hasText ? `${SECRET_TRANSLATED} ${post.ref}` : '',
    isUntranslated: false,
  }));
  return { posts: translated, untranslatedCount: 0 };
}

function summarize(posts: TranslatedPost[]): SummaryResult {
  const refs = posts.filter((post) => post.hasText).map((post) => post.ref);
  return {
    topics: [{ thesis: 'Общий тезис', viewpoints: [], refs, isFallback: false }],
    fallbackTopicCount: 0,
  };
}

function buildConfig(isConfigured = true): DigestConfig {
  return {
    channels: INPUT_CHANNELS,
    cron: '0 23 * * *',
    timezone: 'Europe/Kyiv',
    grokApiKey: 'fake-grok-key',
    grokModel: 'fake-model',
    botToken: INPUT_FAKE_TOKEN,
    botChatId: '-100000',
    isConfigured,
  };
}

describe('DigestService', () => {
  let mockCollect: jest.Mock<Promise<CollectedPosts>, [readonly string[], number]>;
  let mockTranslate: jest.Mock<Promise<TranslationResult>, [DigestPost[]]>;
  let mockSummarize: jest.Mock<Promise<SummaryResult>, [TranslatedPost[]]>;
  let mockSend: jest.Mock<Promise<void>, [readonly string[]]>;
  let loggerSpies: Record<(typeof LOGGER_LEVELS)[number], jest.SpyInstance>;
  let inputPosts: DigestPost[];

  function createService(config = buildConfig()): DigestService {
    return new DigestService(
      config,
      { collect: mockCollect } as unknown as PostCollector,
      { translate: mockTranslate } as unknown as TranslationService,
      { summarize: mockSummarize } as unknown as SummaryService,
      { send: mockSend } as unknown as BotNotifier,
    );
  }

  function allLogCalls(): unknown[][] {
    return LOGGER_LEVELS.flatMap((level) => loggerSpies[level].mock.calls);
  }

  function loggedText(): string {
    return allLogCalls()
      .flat()
      .map((arg) => String(arg))
      .join('\n');
  }

  function sentText(): string {
    return mockSend.mock.calls.map(([messages]) => messages.join('\n')).join('\n');
  }

  beforeEach(() => {
    inputPosts = [buildPost(1), buildPost(2), buildPost(3, false)];
    mockCollect = jest.fn<Promise<CollectedPosts>, [readonly string[], number]>(async () =>
      buildCollected(inputPosts),
    );
    mockTranslate = jest.fn(async (posts: DigestPost[]) => translate(posts));
    mockSummarize = jest.fn(async (posts: TranslatedPost[]) => summarize(posts));
    mockSend = jest.fn<Promise<void>, [readonly string[]]>(async () => undefined);
    loggerSpies = Object.fromEntries(
      LOGGER_LEVELS.map((level) => [
        level,
        jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
      ]),
    ) as Record<(typeof LOGGER_LEVELS)[number], jest.SpyInstance>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('start (POST /digest/run)', () => {
    it('answers started and runs the digest in the background', async () => {
      // Arrange
      const service = createService();

      // Act
      const actualResponse = service.start();
      await flushBackground();

      // Assert
      expect(actualResponse).toEqual({ status: 'started' });
      expect(mockCollect).toHaveBeenCalledWith(INPUT_CHANNELS, DIGEST_WINDOW_HOURS);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(sentText()).toContain('Общий тезис');
    });

    it('returns before the run finishes', () => {
      // Arrange
      const gate = deferred<CollectedPosts>();
      mockCollect.mockReturnValueOnce(gate.promise);
      const service = createService();

      // Act
      const actualResponse = service.start();

      // Assert
      expect(actualResponse).toEqual({ status: 'started' });
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('throws 503 when the digest is not configured and starts nothing', () => {
      // Arrange
      const service = createService(buildConfig(false));

      // Act
      const actualAct = (): unknown => service.start();

      // Assert
      expect(actualAct).toThrow(ServiceUnavailableException);
      expect(actualAct).toThrow(DIGEST_NOT_CONFIGURED_MESSAGE);
      expect(mockCollect).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('throws 409 while a run is in progress, and starts again once it is over', async () => {
      // Arrange
      const gate = deferred<CollectedPosts>();
      mockCollect.mockReturnValueOnce(gate.promise);
      const service = createService();
      service.start();

      // Act
      const actualSecond = (): unknown => service.start();

      // Assert
      expect(actualSecond).toThrow(ConflictException);
      expect(actualSecond).toThrow(DIGEST_ALREADY_RUNNING_MESSAGE);
      expect(mockCollect).toHaveBeenCalledTimes(1);

      gate.resolve(buildCollected(inputPosts));
      await flushBackground();
      expect(service.start()).toEqual({ status: 'started' });
      await flushBackground();
      expect(mockCollect).toHaveBeenCalledTimes(2);
    });

    it('releases the running flag after a failed run', async () => {
      // Arrange
      mockCollect.mockRejectedValueOnce(new Error('fake collector failure'));
      const service = createService();
      service.start();
      await flushBackground();

      // Act
      const actualResponse = service.start();
      await flushBackground();

      // Assert
      expect(actualResponse).toEqual({ status: 'started' });
      expect(mockCollect).toHaveBeenCalledTimes(2);
    });

    it('releases the running flag even when the failure notice cannot be sent', async () => {
      // Arrange
      mockCollect.mockRejectedValueOnce(new UnauthorizedException());
      mockSend.mockRejectedValueOnce(new Error('fake bot down'));
      const service = createService();
      service.start();
      await flushBackground();

      // Act
      const actualResponse = service.start();

      // Assert
      expect(actualResponse).toEqual({ status: 'started' });
    });
  });

  describe('runScheduled', () => {
    it('runs to the end and writes exactly one outcome line', async () => {
      // Arrange
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(allLogCalls()).toHaveLength(1);
      expect(loggerSpies.log).toHaveBeenCalledTimes(1);
      expect(String(loggerSpies.log.mock.calls[0][0])).toMatch(
        /^Digest scheduled: 3 posts, 1 topics, 2 channels, 1 messages, \d+ ms$/,
      );
    });

    it('skips with one warning while a manual run is in progress', async () => {
      // Arrange
      const gate = deferred<CollectedPosts>();
      mockCollect.mockReturnValueOnce(gate.promise);
      const service = createService();
      service.start();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockCollect).toHaveBeenCalledTimes(1);
      expect(loggerSpies.warn).toHaveBeenCalledTimes(1);
      expect(String(loggerSpies.warn.mock.calls[0][0])).toContain('Scheduled digest skipped');

      gate.resolve(buildCollected(inputPosts));
      await flushBackground();
    });

    it('blocks a manual start while the scheduled run is in progress', async () => {
      // Arrange
      const gate = deferred<CollectedPosts>();
      mockCollect.mockReturnValueOnce(gate.promise);
      const service = createService();
      const scheduledRun = service.runScheduled();

      // Act
      const actualStart = (): unknown => service.start();

      // Assert
      expect(actualStart).toThrow(ConflictException);
      gate.resolve(buildCollected(inputPosts));
      await scheduledRun;
      expect(service.start()).toEqual({ status: 'started' });
      await flushBackground();
    });

    it('never rejects when a stage fails', async () => {
      // Arrange
      mockTranslate.mockRejectedValueOnce(new Error('fake translate failure'));
      const service = createService();

      // Act
      const actualRun = service.runScheduled();

      // Assert
      await expect(actualRun).resolves.toBeUndefined();
    });
  });

  describe('pipeline', () => {
    it('applies DIGEST_MAX_POSTS before translation and reports the skipped count', async () => {
      // Arrange
      inputPosts = Array.from({ length: DIGEST_MAX_POSTS + EXTRA_POSTS }, (_, index) =>
        buildPost(index + 1),
      );
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockTranslate.mock.calls[0][0]).toHaveLength(DIGEST_MAX_POSTS);
      expect(sentText()).toContain(`Не вошло сверх лимита: ${EXTRA_POSTS}`);
    });

    it('falls back to one block per post when the summary fails', async () => {
      // Arrange
      mockSummarize.mockRejectedValueOnce(new Error('fake grok failure'));
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockSend).toHaveBeenCalledTimes(1);
      const actualText = sentText();
      expect(actualText).toContain(`• ${SECRET_TRANSLATED} p1`);
      expect(actualText).toContain(`• ${SECRET_TRANSLATED} p2`);
      expect(actualText).toContain('Блоков без группировки: 2');
      expect(actualText).toContain('Саммари не собрано, посты перечислены списком');
      expect(actualText).toContain('Учтено 3 из 3 постов');
      expect(loggerSpies.error).not.toHaveBeenCalled();
    });

    it('passes the translated posts to the summary', async () => {
      // Arrange
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      const [actualPosts] = mockSummarize.mock.calls[0];
      expect(actualPosts.map((post) => post.ref)).toEqual(['p1', 'p2', 'p3']);
      expect(actualPosts[0].translated).toBe(`${SECRET_TRANSLATED} p1`);
    });
  });

  describe('failure notice', () => {
    it.each([
      [HttpStatus.UNAUTHORIZED, SESSION_REASON],
      [HttpStatus.TOO_MANY_REQUESTS, FLOOD_REASON],
      [HttpStatus.SERVICE_UNAVAILABLE, UNAVAILABLE_REASON],
      [HttpStatus.BAD_GATEWAY, GENERIC_REASON],
    ])(
      'sends the reason for a collector failure with status %d and logs one error line',
      async (inputStatus, expectedReason) => {
        // Arrange
        const inputError = new HttpException('fake collector failure', inputStatus);
        mockCollect.mockRejectedValueOnce(inputError);
        const service = createService();

        // Act
        await service.runScheduled();

        // Assert
        expect(mockSend).toHaveBeenCalledTimes(1);
        const [actualMessages] = mockSend.mock.calls[0];
        expect(actualMessages).toHaveLength(1);
        expect(actualMessages[0].startsWith('<b>Дайджест не собран</b>\n')).toBe(true);
        expect(actualMessages[0]).toContain(expectedReason);
        expect(loggerSpies.error).toHaveBeenCalledTimes(1);
        expect(loggerSpies.error.mock.calls[0][0]).toBe(`Digest scheduled failed: ${inputStatus}`);
        expect(loggerSpies.log).not.toHaveBeenCalled();
      },
    );

    it('sends the generic reason and logs the error name and message for a non-HTTP error', async () => {
      // Arrange
      mockTranslate.mockRejectedValueOnce(new TypeError('fake broken answer'));
      const service = createService();

      // Act
      service.start();
      await flushBackground();

      // Assert
      expect(mockSend.mock.calls[0][0][0]).toContain(GENERIC_REASON);
      expect(loggerSpies.error.mock.calls[0][0]).toBe(
        'Digest manual failed: TypeError (fake broken answer)',
      );
    });

    it('reports a digest that the bot refused with a notice attempt', async () => {
      // Arrange
      mockSend.mockRejectedValueOnce(new Error('HTTP 400 (fake parse error)'));
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockSend.mock.calls[1][0][0]).toContain(GENERIC_REASON);
      expect(loggerSpies.error).toHaveBeenCalledTimes(1);
      expect(loggerSpies.log).not.toHaveBeenCalled();
    });

    it('only logs when the failure notice itself cannot be delivered', async () => {
      // Arrange
      mockCollect.mockRejectedValueOnce(new UnauthorizedException());
      mockSend.mockRejectedValueOnce(new Error('fake bot down'));
      const service = createService();

      // Act
      const actualRun = service.runScheduled();

      // Assert
      await expect(actualRun).resolves.toBeUndefined();
      expect(loggerSpies.error).toHaveBeenCalledTimes(2);
      expect(loggerSpies.error.mock.calls[1][0]).toBe('Digest failure notice not delivered');
    });
  });

  describe('log hygiene', () => {
    it('never logs post text, translations or the bot token on any path', async () => {
      // Arrange
      const service = createService();
      await service.runScheduled();
      mockSummarize.mockRejectedValueOnce(new Error('fake grok failure'));
      await service.runScheduled();
      mockCollect.mockRejectedValueOnce(new UnauthorizedException());
      mockSend.mockRejectedValueOnce(new Error('fake bot down'));

      // Act
      await service.runScheduled();

      // Assert
      const actualText = loggedText();
      expect(actualText).not.toContain(SECRET_ORIGINAL);
      expect(actualText).not.toContain(SECRET_TRANSLATED);
      expect(actualText).not.toContain(INPUT_FAKE_TOKEN);
    });
  });
});
