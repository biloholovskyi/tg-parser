import {
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AlertService } from '../alerts/alert.service';
import type { DigestConfig, DigestTranslationMode } from '../config/digest.config';
import { BotError } from './bot-notifier';
import type { BotNotifier } from './bot-notifier';
import { DIGEST_MAX_POSTS, DIGEST_WINDOW_HOURS } from './constants';
import {
  DIGEST_ALREADY_RUNNING_MESSAGE,
  DIGEST_NOT_CONFIGURED_MESSAGE,
  DigestService,
} from './digest.service';
import type { CollectedPosts, DigestPost } from './interfaces/digest-post.interface';
import type {
  DigestTopic,
  SummaryResult,
  ThesisTranslationResult,
  TranslatedPost,
  TranslationResult,
} from './interfaces/digest-topic.interface';
import type { PostCollector } from './post-collector';
import type { SummaryService } from './summary.service';
import type { TranslationService } from './translation.service';
import { delayUnlessCancelled } from './utils/cancellable-delay';

/** The real collector imports the TelegramService facade, which loads GramJS. */
jest.mock('./post-collector', () => ({ PostCollector: class {} }));

const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const INPUT_FAKE_TOKEN = 'fake-bot-token';
const INPUT_FAKE_GROK_KEY = 'fake-grok-key';
/** Shaped like a GramJS StringSession; built in code so no fixture holds a session-like literal. */
const INPUT_FAKE_SESSION = '1' + 'A'.repeat(250);
const INPUT_CHANNELS = ['fake_alpha', 'fake_beta'];
const SECRET_ORIGINAL = 'SECRET-ORIGINAL-POST-BODY';
const SECRET_TRANSLATED = 'SECRET-TRANSLATED-POST-BODY';
const BASE_DATE_MS = Date.UTC(2026, 0, 1);
const FLUSH_ROUNDS = 20;
const EXTRA_POSTS = 5;
/** Text posts in the default fixture, listed one block each by the summary fallback. */
const EXPECTED_FALLBACK_TOPICS = 2;
/** Two progress lines plus the outcome line. */
const EXPECTED_SUCCESS_LOG_LINES = 3;
/** Fake duration of a run in the exact outcome-line test. */
const INPUT_ELAPSED_MS = 2468;
const SESSION_REASON = 'Сессия дайджеста не задана или отозвана';
const FLOOD_REASON = 'Telegram ограничил частоту запросов';
const UNAVAILABLE_REASON = 'Telegram или хранилище сессий недоступны';
const GENERIC_REASON = 'Внутренняя ошибка, подробности в логах сервиса.';

type CollectArgs = [readonly string[], number, AbortSignal?];

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

/** A post as the summary reads it with DIGEST_TRANSLATION=off. */
function asOriginalPost(post: DigestPost): TranslatedPost {
  return { ...post, translated: post.text, isUntranslated: false };
}

/** The pre-existing suites run with DIGEST_TRANSLATION=on, where every post is translated. */
function buildConfig(
  isConfigured = true,
  translationMode: DigestTranslationMode = 'on',
): DigestConfig {
  return {
    channels: INPUT_CHANNELS,
    cron: '0 23 * * *',
    timezone: 'Europe/Kyiv',
    grokApiKey: INPUT_FAKE_GROK_KEY,
    grokModel: 'fake-model',
    grokReasoningEffort: 'low',
    translationMode,
    grokTranslationModel: 'fake-translation-model',
    grokTranslationReasoningEffort: 'off',
    botToken: INPUT_FAKE_TOKEN,
    botChatId: '-100000',
    isConfigured,
  };
}

describe('DigestService', () => {
  let mockCollect: jest.Mock<Promise<CollectedPosts>, CollectArgs>;
  let mockTranslate: jest.Mock<Promise<TranslationResult>, [DigestPost[]]>;
  let mockSummarize: jest.Mock<Promise<SummaryResult>, [TranslatedPost[]]>;
  let mockTranslateTheses: jest.Mock<Promise<ThesisTranslationResult>, [DigestTopic[]]>;
  let mockSend: jest.Mock<Promise<void>, [readonly string[]]>;
  let mockAlerts: { info: jest.Mock; warning: jest.Mock; error: jest.Mock };
  let loggerSpies: Record<(typeof LOGGER_LEVELS)[number], jest.SpyInstance>;
  let inputPosts: DigestPost[];

  function createService(config = buildConfig()): DigestService {
    return new DigestService(
      config,
      { collect: mockCollect } as unknown as PostCollector,
      {
        translate: mockTranslate,
        translateTheses: mockTranslateTheses,
      } as unknown as TranslationService,
      { summarize: mockSummarize } as unknown as SummaryService,
      { send: mockSend } as unknown as BotNotifier,
      mockAlerts as unknown as AlertService,
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
    mockCollect = jest.fn<Promise<CollectedPosts>, CollectArgs>(async () =>
      buildCollected(inputPosts),
    );
    mockTranslate = jest.fn(async (posts: DigestPost[]) => translate(posts));
    mockSummarize = jest.fn(async (posts: TranslatedPost[]) => summarize(posts));
    mockTranslateTheses = jest.fn(async (topics: DigestTopic[]) => ({
      topics,
      untranslatedCount: 0,
    }));
    mockSend = jest.fn<Promise<void>, [readonly string[]]>(async () => undefined);
    mockAlerts = { info: jest.fn(), warning: jest.fn(), error: jest.fn() };
    loggerSpies = Object.fromEntries(
      LOGGER_LEVELS.map((level) => [
        level,
        jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
      ]),
    ) as Record<(typeof LOGGER_LEVELS)[number], jest.SpyInstance>;
  });

  afterEach(() => {
    jest.useRealTimers();
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
      expect(mockCollect).toHaveBeenCalledWith(
        INPUT_CHANNELS,
        DIGEST_WINDOW_HOURS,
        expect.any(AbortSignal),
      );
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
    it('runs to the end and writes two progress lines and one outcome line', async () => {
      // Arrange
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(allLogCalls()).toHaveLength(EXPECTED_SUCCESS_LOG_LINES);
      expect(loggerSpies.log).toHaveBeenCalledTimes(EXPECTED_SUCCESS_LOG_LINES);
      const actualLines = loggerSpies.log.mock.calls.map((call: unknown[]) => String(call[0]));
      expect(actualLines[0]).toBe('Digest: collected 3 posts, translating');
      expect(actualLines[1]).toBe('Digest: summarizing');
      expect(actualLines[2]).toMatch(
        /^Digest scheduled: 3 posts, 1 topics, 2 channels, 1 messages, \d+ ms$/,
      );
    });

    it('writes the exact elapsed time in the outcome line', async () => {
      // Arrange
      jest.useFakeTimers({ now: BASE_DATE_MS });
      mockSend.mockImplementationOnce(async () => {
        jest.setSystemTime(BASE_DATE_MS + INPUT_ELAPSED_MS);
      });
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      const actualLines = loggerSpies.log.mock.calls.map((call: unknown[]) => String(call[0]));
      expect(actualLines[actualLines.length - 1]).toBe(
        `Digest scheduled: 3 posts, 1 topics, 2 channels, 1 messages, ${INPUT_ELAPSED_MS} ms`,
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
      expect(actualText).toContain('Учтено 2 из 2 постов');
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

  describe('DIGEST_TRANSLATION=off', () => {
    const THESIS_TRANSLATION = 'Переведённый резервный тезис';

    function createOffService(): DigestService {
      return createService(buildConfig(true, 'off'));
    }

    it('never calls translate and gives the summary the originals with translated === text', async () => {
      // Arrange
      const service = createOffService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockTranslate).not.toHaveBeenCalled();
      expect(mockSummarize).toHaveBeenCalledTimes(1);
      const [actualPosts] = mockSummarize.mock.calls[0];
      expect(actualPosts).toEqual(
        inputPosts.map((post) => ({ ...post, translated: post.text, isUntranslated: false })),
      );
      expect(sentText()).not.toContain(SECRET_TRANSLATED);
    });

    it('logs that the originals are summarized instead of translating', async () => {
      // Arrange
      const service = createOffService();

      // Act
      await service.runScheduled();

      // Assert
      expect(allLogCalls().map(([message]) => String(message))).toContain(
        `Digest: collected ${inputPosts.length} posts, summarizing the originals`,
      );
      expect(loggedText()).not.toContain('translating');
      expect(allLogCalls()).toHaveLength(EXPECTED_SUCCESS_LOG_LINES);
    });

    it('applies DIGEST_MAX_POSTS before the summary', async () => {
      // Arrange
      inputPosts = Array.from({ length: DIGEST_MAX_POSTS + EXTRA_POSTS }, (_, index) =>
        buildPost(index + 1),
      );
      const service = createOffService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockSummarize.mock.calls[0][0]).toHaveLength(DIGEST_MAX_POSTS);
      expect(sentText()).toContain(`Не вошло сверх лимита: ${EXTRA_POSTS}`);
    });

    it('passes the summary topics to translateTheses after the summary', async () => {
      // Arrange
      const service = createOffService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockTranslateTheses).toHaveBeenCalledTimes(1);
      const [actualTopics] = mockTranslateTheses.mock.calls[0];
      expect(actualTopics).toEqual(summarize(inputPosts.map(asOriginalPost)).topics);
      expect(mockTranslateTheses.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockSummarize.mock.invocationCallOrder[0],
      );
      expect(mockTranslateTheses.mock.invocationCallOrder[0]).toBeLessThan(
        mockSend.mock.invocationCallOrder[0],
      );
    });

    it('sends the theses translateTheses returned and its untranslated count', async () => {
      // Arrange
      mockSummarize.mockResolvedValueOnce({
        topics: [
          { thesis: 'Общий тезис', viewpoints: [], refs: ['p1'], isFallback: false },
          { thesis: `${SECRET_ORIGINAL} 2`, viewpoints: [], refs: ['p2'], isFallback: true },
        ],
        fallbackTopicCount: 1,
      });
      mockTranslateTheses.mockImplementationOnce(async (topics: DigestTopic[]) => ({
        topics: topics.map((topic) =>
          topic.isFallback ? { ...topic, thesis: THESIS_TRANSLATION } : topic,
        ),
        untranslatedCount: 1,
      }));
      const service = createOffService();

      // Act
      await service.runScheduled();

      // Assert
      const actualText = sentText();
      expect(actualText).toContain(THESIS_TRANSLATION);
      expect(actualText).toContain('Общий тезис');
      expect(actualText).not.toContain(`${SECRET_ORIGINAL} 2`);
      expect(actualText).toContain('Без перевода: 1');
      expect(mockAlerts.warning).toHaveBeenCalledWith(
        'Digest delivered with gaps',
        expect.objectContaining({ untranslatedCount: 1, fallbackTopicCount: 1 }),
      );
    });

    it('reports no untranslated posts and no gap when every thesis is translated', async () => {
      // Arrange
      const service = createOffService();

      // Act
      await service.runScheduled();

      // Assert
      expect(sentText()).not.toContain('Без перевода');
      expect(mockAlerts.warning).not.toHaveBeenCalled();
    });

    it('lists the originals when the summary fails and then translates their theses', async () => {
      // Arrange
      mockSummarize.mockRejectedValueOnce(new Error('fake grok failure'));
      mockTranslateTheses.mockImplementationOnce(async (topics: DigestTopic[]) => ({
        topics: topics.map((topic) => ({
          ...topic,
          thesis: `${THESIS_TRANSLATION} ${topic.refs[0]}`,
        })),
        untranslatedCount: 0,
      }));
      const service = createOffService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockTranslateTheses).toHaveBeenCalledTimes(1);
      const [actualTopics] = mockTranslateTheses.mock.calls[0];
      expect(actualTopics).toEqual([
        { thesis: `${SECRET_ORIGINAL} 1`, viewpoints: [], refs: ['p1'], isFallback: true },
        { thesis: `${SECRET_ORIGINAL} 2`, viewpoints: [], refs: ['p2'], isFallback: true },
      ]);
      const actualText = sentText();
      expect(actualText).toContain(`• ${THESIS_TRANSLATION} p1`);
      expect(actualText).toContain(`• ${THESIS_TRANSLATION} p2`);
      expect(actualText).not.toContain(SECRET_ORIGINAL);
      expect(actualText).toContain('Саммари не собрано, посты перечислены списком');
      expect(actualText).toContain(`Блоков без группировки: ${EXPECTED_FALLBACK_TOPICS}`);
    });

    it('counts the fallback theses left untranslated after a summary failure', async () => {
      // Arrange
      mockSummarize.mockRejectedValueOnce(new Error('fake grok failure'));
      mockTranslateTheses.mockImplementationOnce(async (topics: DigestTopic[]) => ({
        topics,
        untranslatedCount: topics.length,
      }));
      const service = createOffService();

      // Act
      await service.runScheduled();

      // Assert
      expect(sentText()).toContain(`Без перевода: ${EXPECTED_FALLBACK_TOPICS}`);
      expect(mockAlerts.warning).toHaveBeenCalledWith(
        'Digest delivered with gaps',
        expect.objectContaining({
          isSummaryFallback: true,
          untranslatedCount: EXPECTED_FALLBACK_TOPICS,
        }),
      );
    });

    it('reports a translateTheses failure as a failed run', async () => {
      // Arrange
      mockTranslateTheses.mockRejectedValueOnce(new TypeError('fake thesis failure'));
      const service = createOffService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(sentText()).toContain(GENERIC_REASON);
      expect(mockAlerts.error).toHaveBeenCalledWith('Digest run failed', expect.anything());
    });
  });

  describe('DIGEST_TRANSLATION=on', () => {
    it('translates before the summary and never calls translateTheses', async () => {
      // Arrange
      const service = createService(buildConfig(true, 'on'));

      // Act
      await service.runScheduled();

      // Assert
      expect(mockTranslate).toHaveBeenCalledTimes(1);
      expect(mockTranslateTheses).not.toHaveBeenCalled();
      expect(mockTranslate.mock.invocationCallOrder[0]).toBeLessThan(
        mockSummarize.mock.invocationCallOrder[0],
      );
      expect(mockSummarize.mock.calls[0][0][0].translated).toBe(`${SECRET_TRANSLATED} p1`);
    });

    it('keeps the summary-fallback topics as translated, without translateTheses', async () => {
      // Arrange
      mockSummarize.mockRejectedValueOnce(new Error('fake grok failure'));
      const service = createService(buildConfig(true, 'on'));

      // Act
      await service.runScheduled();

      // Assert
      expect(mockTranslateTheses).not.toHaveBeenCalled();
      expect(sentText()).toContain(`• ${SECRET_TRANSLATED} p1`);
    });

    it('reports only the untranslated posts of translate', async () => {
      // Arrange
      mockTranslate.mockImplementationOnce(async (posts: DigestPost[]) => ({
        ...translate(posts),
        untranslatedCount: 1,
      }));
      const service = createService(buildConfig(true, 'on'));

      // Act
      await service.runScheduled();

      // Assert
      expect(sentText()).toContain('Без перевода: 1');
    });
  });

  describe('progress lines', () => {
    function logIndexOf(line: string): number {
      return loggerSpies.log.mock.calls.findIndex((call: unknown[]) => call[0] === line);
    }

    it('logs the collected count before translation starts', async () => {
      // Arrange
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      const actualIndex = logIndexOf('Digest: collected 3 posts, translating');
      expect(actualIndex).toBe(0);
      expect(loggerSpies.log.mock.invocationCallOrder[actualIndex]).toBeLessThan(
        mockTranslate.mock.invocationCallOrder[0],
      );
    });

    it('logs summarizing after translation and before the summary starts', async () => {
      // Arrange
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      const actualIndex = logIndexOf('Digest: summarizing');
      const actualOrder = loggerSpies.log.mock.invocationCallOrder[actualIndex];
      expect(actualOrder).toBeGreaterThan(mockTranslate.mock.invocationCallOrder[0]);
      expect(actualOrder).toBeLessThan(mockSummarize.mock.invocationCallOrder[0]);
    });

    it('counts the posts kept after DIGEST_MAX_POSTS, not the collected total', async () => {
      // Arrange
      inputPosts = Array.from({ length: DIGEST_MAX_POSTS + EXTRA_POSTS }, (_, index) =>
        buildPost(index + 1),
      );
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(logIndexOf(`Digest: collected ${DIGEST_MAX_POSTS} posts, translating`)).toBe(0);
    });

    it('logs only the collected line before a translation failure', async () => {
      // Arrange
      mockTranslate.mockRejectedValueOnce(new Error('fake translate failure'));
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      const actualLines = loggerSpies.log.mock.calls.map((call: unknown[]) => String(call[0]));
      expect(actualLines).toEqual(['Digest: collected 3 posts, translating']);
      expect(mockSummarize).not.toHaveBeenCalled();
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
      const actualLines = loggerSpies.log.mock.calls.map((call: unknown[]) => String(call[0]));
      expect(actualLines).toEqual([
        'Digest: collected 3 posts, translating',
        'Digest: summarizing',
      ]);
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

  describe('alerts', () => {
    const GAPS_MESSAGE = 'Digest delivered with gaps';
    const FAILED_MESSAGE = 'Digest run failed';
    const NOTICE_MESSAGE = 'Digest failure notice not delivered';
    const SKIPPED_MESSAGE = 'Scheduled digest skipped: a run is already in progress';

    function alertedText(): string {
      return [mockAlerts.info, mockAlerts.warning, mockAlerts.error]
        .flatMap((mock) => mock.mock.calls)
        .map((call: unknown[]) => JSON.stringify(call))
        .join('\n');
    }

    it('sends one error with the 401 status and the session reason, without the session', async () => {
      // Arrange
      mockCollect.mockRejectedValueOnce(new UnauthorizedException(`fake ${INPUT_FAKE_SESSION}`));
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockAlerts.error).toHaveBeenCalledTimes(1);
      expect(mockAlerts.error).toHaveBeenCalledWith(FAILED_MESSAGE, {
        trigger: 'scheduled',
        cause: String(HttpStatus.UNAUTHORIZED),
        reason: expect.stringContaining(SESSION_REASON),
      });
      expect(mockAlerts.warning).not.toHaveBeenCalled();
      expect(alertedText()).not.toContain(INPUT_FAKE_SESSION);
    });

    it('describes a non-HTTP failure in the cause as its name and message', async () => {
      // Arrange
      mockTranslate.mockRejectedValueOnce(new TypeError('fake broken answer'));
      const service = createService();

      // Act
      service.start();
      await flushBackground();

      // Assert
      expect(mockAlerts.error).toHaveBeenCalledWith(FAILED_MESSAGE, {
        trigger: 'manual',
        cause: 'TypeError: fake broken answer',
        reason: GENERIC_REASON,
      });
    });

    it('sends a second error when the failure notice itself fails with a BotError', async () => {
      // Arrange
      mockCollect.mockRejectedValueOnce(new UnauthorizedException());
      mockSend.mockRejectedValueOnce(new BotError('HTTP 502 (fake bad gateway)', true));
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockAlerts.error).toHaveBeenCalledTimes(2);
      expect(mockAlerts.error.mock.calls[0][0]).toBe(FAILED_MESSAGE);
      expect(mockAlerts.error).toHaveBeenLastCalledWith(NOTICE_MESSAGE, {
        trigger: 'scheduled',
        cause: 'BotError: HTTP 502 (fake bad gateway)',
      });
    });

    it.each([
      ['a string', 'fake string rejection', 'fake string rejection'],
      ['a plain object', { detail: 'fake-hidden-payload' }, 'unknown error'],
      ['undefined', undefined, 'unknown error'],
    ])(
      'describes a failure notice rejected with %s through describeError',
      async (_label, inputRejection, expectedCause) => {
        // Arrange
        mockCollect.mockRejectedValueOnce(new UnauthorizedException());
        mockSend.mockRejectedValueOnce(inputRejection);
        const service = createService();

        // Act
        await service.runScheduled();

        // Assert
        expect(mockAlerts.error).toHaveBeenLastCalledWith(NOTICE_MESSAGE, {
          trigger: 'scheduled',
          cause: expectedCause,
        });
        expect(alertedText()).not.toContain('fake-hidden-payload');
      },
    );

    it.each([
      ['a string', 'fake string failure', 'fake string failure'],
      ['a plain object', { detail: 'fake-hidden-payload' }, 'unknown error'],
    ])(
      'describes a run rejected with %s through describeError',
      async (_label, inputRejection, expectedCause) => {
        // Arrange
        mockCollect.mockRejectedValueOnce(inputRejection);
        const service = createService();

        // Act
        await service.runScheduled();

        // Assert
        expect(mockAlerts.error).toHaveBeenCalledWith(FAILED_MESSAGE, {
          trigger: 'scheduled',
          cause: expectedCause,
          reason: GENERIC_REASON,
        });
        expect(alertedText()).not.toContain('fake-hidden-payload');
      },
    );

    it('reports a bot-refused digest as one run failure and no gap warning', async () => {
      // Arrange
      mockSend.mockRejectedValueOnce(new BotError('HTTP 400 (fake parse error)', false));
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockAlerts.error).toHaveBeenCalledTimes(1);
      expect(mockAlerts.error).toHaveBeenCalledWith(FAILED_MESSAGE, {
        trigger: 'scheduled',
        cause: 'BotError: HTTP 400 (fake parse error)',
        reason: GENERIC_REASON,
      });
      expect(mockAlerts.warning).not.toHaveBeenCalled();
    });

    it('sends one warning with every counter for a summary fallback and an unavailable channel', async () => {
      // Arrange
      mockCollect.mockResolvedValueOnce({
        ...buildCollected(inputPosts),
        unavailableChannels: ['fake_beta'],
      });
      mockSummarize.mockRejectedValueOnce(new Error('fake grok failure'));
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockAlerts.warning).toHaveBeenCalledTimes(1);
      expect(mockAlerts.warning).toHaveBeenCalledWith(GAPS_MESSAGE, {
        trigger: 'scheduled',
        isSummaryFallback: true,
        unavailableChannels: ['fake_beta'],
        truncatedChannels: [],
        untranslatedCount: 0,
        skippedPostCount: 0,
        fallbackTopicCount: EXPECTED_FALLBACK_TOPICS,
      });
      expect(mockAlerts.error).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a truncated channel',
        { truncatedChannels: ['fake_alpha'] },
        { truncatedChannels: ['fake_alpha'] },
      ],
      ['an untranslated post', { untranslatedCount: 1 }, { untranslatedCount: 1 }],
    ])('sends one gap warning for %s', async (_label, inputGap, expectedDetails) => {
      // Arrange
      const { truncatedChannels, untranslatedCount } = {
        truncatedChannels: [] as string[],
        untranslatedCount: 0,
        ...inputGap,
      };
      mockCollect.mockResolvedValueOnce({ ...buildCollected(inputPosts), truncatedChannels });
      mockTranslate.mockImplementationOnce(async (posts: DigestPost[]) => ({
        ...translate(posts),
        untranslatedCount,
      }));
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockAlerts.warning).toHaveBeenCalledTimes(1);
      expect(mockAlerts.warning).toHaveBeenCalledWith(
        GAPS_MESSAGE,
        expect.objectContaining({ isSummaryFallback: false, ...expectedDetails }),
      );
    });

    it('sends one gap warning with the skipped count past DIGEST_MAX_POSTS', async () => {
      // Arrange
      inputPosts = Array.from({ length: DIGEST_MAX_POSTS + EXTRA_POSTS }, (_, index) =>
        buildPost(index + 1),
      );
      const service = createService();

      // Act
      service.start();
      await flushBackground();

      // Assert
      expect(mockAlerts.warning).toHaveBeenCalledTimes(1);
      expect(mockAlerts.warning).toHaveBeenCalledWith(
        GAPS_MESSAGE,
        expect.objectContaining({ trigger: 'manual', skippedPostCount: EXTRA_POSTS }),
      );
    });

    it('sends no alert for a clean run', async () => {
      // Arrange
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockAlerts.info).not.toHaveBeenCalled();
      expect(mockAlerts.warning).not.toHaveBeenCalled();
      expect(mockAlerts.error).not.toHaveBeenCalled();
    });

    it('does not treat fallback topics alone as a gap', async () => {
      // Arrange
      mockSummarize.mockImplementationOnce(async (posts: TranslatedPost[]) => ({
        ...summarize(posts),
        fallbackTopicCount: 1,
      }));
      const service = createService();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockAlerts.warning).not.toHaveBeenCalled();
      expect(mockAlerts.error).not.toHaveBeenCalled();
    });

    it('sends one warning when a scheduled run is skipped while another run is in progress', async () => {
      // Arrange
      const gate = deferred<CollectedPosts>();
      mockCollect.mockReturnValueOnce(gate.promise);
      const service = createService();
      service.start();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockAlerts.warning).toHaveBeenCalledTimes(1);
      expect(mockAlerts.warning).toHaveBeenCalledWith(SKIPPED_MESSAGE);

      gate.resolve(buildCollected(inputPosts));
      await flushBackground();
      expect(mockAlerts.warning).toHaveBeenCalledTimes(1);
    });

    it('never puts the bot token, the Grok key or a session string into any alert', async () => {
      // Arrange
      const service = createService();
      mockCollect.mockResolvedValueOnce({
        ...buildCollected(inputPosts),
        unavailableChannels: ['fake_beta'],
      });
      mockSummarize.mockRejectedValueOnce(new Error(`fake grok failure ${INPUT_FAKE_GROK_KEY}`));
      await service.runScheduled();
      mockCollect.mockRejectedValueOnce(new UnauthorizedException(`fake ${INPUT_FAKE_SESSION}`));
      mockSend.mockRejectedValueOnce(new BotError('HTTP 401 (fake unauthorized)', false));
      await service.runScheduled();
      const gate = deferred<CollectedPosts>();
      mockCollect.mockReturnValueOnce(gate.promise);
      service.start();

      // Act
      await service.runScheduled();
      gate.resolve(buildCollected(inputPosts));
      await flushBackground();

      // Assert
      expect(mockAlerts.warning).toHaveBeenCalled();
      expect(mockAlerts.error).toHaveBeenCalled();
      const actualText = alertedText();
      expect(actualText).not.toContain(INPUT_FAKE_TOKEN);
      expect(actualText).not.toContain(INPUT_FAKE_GROK_KEY);
      expect(actualText).not.toContain(INPUT_FAKE_SESSION);
      expect(actualText).not.toContain(SECRET_ORIGINAL);
      expect(actualText).not.toContain(SECRET_TRANSLATED);
    });
  });

  describe('cancellation on shutdown (onModuleDestroy)', () => {
    /** A Telegram flood wait the fake collector sits out, far longer than any test runs. */
    const INPUT_FLOOD_WAIT_MS = 30 * 60 * 1000;
    const EXPECTED_CANCELLED_LINE = 'cancelled: the application is shutting down';

    /** A collector that is sitting out a flood limit when the run is cancelled. */
    function collectWaitingOnFloodLimit(): void {
      mockCollect.mockImplementationOnce(async (_channels, _hoursBack, signal) => {
        if (!signal) {
          throw new Error('fake collector expected a signal');
        }
        await delayUnlessCancelled(INPUT_FLOOD_WAIT_MS, signal);
        return buildCollected(inputPosts);
      });
    }

    function noAlertSent(): boolean {
      return [mockAlerts.info, mockAlerts.warning, mockAlerts.error].every(
        (mock) => mock.mock.calls.length === 0,
      );
    }

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    });

    it('ends a manual run waiting in collect at once, sends nothing and alerts nothing', async () => {
      // Arrange
      collectWaitingOnFloodLimit();
      const service = createService();
      service.start();
      await flushBackground();
      const actualTimersWhileWaiting = jest.getTimerCount();

      // Act
      service.onModuleDestroy();
      await flushBackground();

      // Assert
      expect(actualTimersWhileWaiting).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
      expect(mockTranslate).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
      expect(noAlertSent()).toBe(true);
      expect(loggerSpies.error).not.toHaveBeenCalled();
      expect(loggerSpies.warn).toHaveBeenCalledTimes(1);
      expect(loggerSpies.warn).toHaveBeenCalledWith(`Digest manual ${EXPECTED_CANCELLED_LINE}`);
    });

    it('releases the running flag, so a later start() is accepted and runs', async () => {
      // Arrange
      collectWaitingOnFloodLimit();
      const service = createService();
      service.start();
      await flushBackground();
      service.onModuleDestroy();
      await flushBackground();

      // Act
      const actualResponse = service.start();
      await flushBackground();

      // Assert
      expect(actualResponse).toEqual({ status: 'started' });
      expect(mockCollect).toHaveBeenCalledTimes(2);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('lets a cancelled scheduled run resolve with its own warn line', async () => {
      // Arrange
      collectWaitingOnFloodLimit();
      const service = createService();
      const actualRun = service.runScheduled();
      await flushBackground();

      // Act
      service.onModuleDestroy();
      await actualRun;

      // Assert
      expect(mockSend).not.toHaveBeenCalled();
      expect(noAlertSent()).toBe(true);
      expect(loggerSpies.warn).toHaveBeenCalledWith(`Digest scheduled ${EXPECTED_CANCELLED_LINE}`);
    });

    it('passes each run its own signal, not aborted while the run is live', async () => {
      // Arrange
      const service = createService();

      // Act
      await service.runScheduled();
      await service.runScheduled();

      // Assert
      const [[, , actualFirst], [, , actualSecond]] = mockCollect.mock.calls;
      expect(actualFirst).toBeInstanceOf(AbortSignal);
      expect(actualSecond).toBeInstanceOf(AbortSignal);
      expect(actualFirst).not.toBe(actualSecond);
      expect(actualFirst?.aborted).toBe(false);
    });

    it('answers 409 to start() while a run waits on a flood limit', async () => {
      // Arrange
      collectWaitingOnFloodLimit();
      const service = createService();
      service.start();
      await flushBackground();

      // Act
      const actualSecond = (): unknown => service.start();

      // Assert
      expect(actualSecond).toThrow(ConflictException);
      expect(actualSecond).toThrow(DIGEST_ALREADY_RUNNING_MESSAGE);
      expect(mockCollect).toHaveBeenCalledTimes(1);

      service.onModuleDestroy();
      await flushBackground();
    });

    it('is a no-op when no run is in progress', async () => {
      // Arrange
      const service = createService();
      await service.runScheduled();
      jest.clearAllMocks();

      // Act
      const actualAct = (): void => service.onModuleDestroy();

      // Assert
      expect(actualAct).not.toThrow();
      expect(service.start()).toEqual({ status: 'started' });
      await flushBackground();
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(loggerSpies.warn).not.toHaveBeenCalled();
    });

    it('does not abort a run that started after an earlier shutdown call', async () => {
      // Arrange
      const service = createService();
      service.onModuleDestroy();

      // Act
      await service.runScheduled();

      // Assert
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(loggerSpies.warn).not.toHaveBeenCalled();
    });
  });
});
