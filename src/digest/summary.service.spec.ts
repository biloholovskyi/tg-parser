import { Logger } from '@nestjs/common';
import {
  DIGEST_FALLBACK_THESIS_CHARS,
  GROK_SUMMARY_MAX_RETRIES,
  GROK_SUMMARY_TIMEOUT_MS,
  SUMMARY_COVERAGE_RETRIES,
  SUMMARY_POST_MAX_CHARS,
} from './constants';
import { GrokClient, GrokError } from './grok/grok.client';
import type { GrokJsonRequest } from './grok/grok.client';
import { SUMMARY_COVERAGE_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from './grok/prompts';
import { COVERAGE_SCHEMA, SUMMARY_SCHEMA, isCoverageAnswer, isSummaryAnswer } from './grok/schemas';
import type { CoverageAnswer, SummaryAnswer, TopicAnswer } from './grok/schemas';
import type { DigestTopic, TranslatedPost } from './interfaces/digest-topic.interface';
import { SummaryService } from './summary.service';

type CompleteJson = jest.Mock<Promise<unknown>, [GrokJsonRequest<unknown>]>;

const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const BASE_DATE_MS = Date.UTC(2026, 0, 1);
const SECRET_MARKER = 'SECRET-TRANSLATED-BODY';
const ORIGINAL_MARKER = 'SECRET-ORIGINAL-BODY';
/** Fake time the first Grok call takes in the log-line test. */
const INPUT_ELAPSED_MS = 4321;
const REF_PATTERN = /^\[(p\d+)\] /gm;
const TOPIC_NUMBER_OUT_OF_RANGE = 99;
const TOTAL_CALLS_WITH_RETRIES = 1 + SUMMARY_COVERAGE_RETRIES;

function buildPost(index: number, hasText = true): TranslatedPost {
  return {
    ref: `p${index}`,
    channel: `fake_channel_${index % 2}`,
    url: `https://t.me/fake/${index}`,
    text: hasText ? `fake original ${index} ${ORIGINAL_MARKER}` : '',
    translated: hasText ? `фейковый перевод ${index} ${SECRET_MARKER}` : '',
    date: new Date(BASE_DATE_MS + index),
    hasText,
    isUntranslated: false,
  };
}

function topic(refs: string[], thesis = `thesis ${refs.join(',')}`): TopicAnswer {
  return { thesis, viewpoints: [], refs };
}

function summary(...topics: TopicAnswer[]): SummaryAnswer {
  return { topics };
}

function coverage(
  additions: CoverageAnswer['additions'],
  newTopics: TopicAnswer[] = [],
): CoverageAnswer {
  return { additions, newTopics };
}

function refsIn(user: string): string[] {
  return [...user.matchAll(REF_PATTERN)].map((match) => match[1]);
}

function unionOfRefs(topics: DigestTopic[]): string[] {
  return [...new Set(topics.flatMap((item) => item.refs))].sort();
}

describe('SummaryService', () => {
  let mockCompleteJson: CompleteJson;
  let loggerSpies: jest.SpyInstance[];
  let service: SummaryService;

  function loggedText(): string {
    return loggerSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => String(arg))
      .join('\n');
  }

  function logCallCount(): number {
    return loggerSpies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
  }

  beforeEach(() => {
    mockCompleteJson = jest.fn();
    loggerSpies = LOGGER_LEVELS.map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    service = new SummaryService({ completeJson: mockCompleteJson } as unknown as GrokClient);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('first request', () => {
    it('makes no call and returns no topics when no post has text', async () => {
      // Act
      const actual = await service.summarize([buildPost(1, false), buildPost(2, false)]);

      // Assert
      expect(mockCompleteJson).not.toHaveBeenCalled();
      expect(actual).toEqual({ topics: [], fallbackTopicCount: 0 });
    });

    it('sends only posts with text as [ref] @channel: translation, with the summary schema', async () => {
      // Arrange
      mockCompleteJson.mockResolvedValueOnce(summary(topic(['p1', 'p3'])));
      const inputPosts = [buildPost(1), buildPost(2, false), buildPost(3)];

      // Act
      await service.summarize(inputPosts);

      // Assert
      expect(mockCompleteJson).toHaveBeenCalledTimes(1);
      expect(mockCompleteJson).toHaveBeenCalledWith({
        system: SUMMARY_SYSTEM_PROMPT,
        user: `[p1] @fake_channel_1: ${inputPosts[0].translated}\n\n[p3] @fake_channel_1: ${inputPosts[2].translated}`,
        schemaName: 'digest',
        schema: SUMMARY_SCHEMA,
        isValid: isSummaryAnswer,
        timeoutMs: GROK_SUMMARY_TIMEOUT_MS,
        maxRetries: GROK_SUMMARY_MAX_RETRIES,
        isTimeoutRetryable: false,
      });
    });

    it('gives only the first request the long timeout, its own retry limit and no timeout retry', async () => {
      // Arrange
      mockCompleteJson
        .mockResolvedValueOnce(summary(topic(['p1'])))
        .mockResolvedValue(coverage([]));
      const inputPosts = [buildPost(1), buildPost(2), buildPost(3)];

      // Act
      await service.summarize(inputPosts);

      // Assert
      expect(mockCompleteJson).toHaveBeenCalledTimes(TOTAL_CALLS_WITH_RETRIES);
      const [actualFirst, ...actualFollowUps] = mockCompleteJson.mock.calls.map(
        ([request]) => request,
      );
      expect(actualFirst.timeoutMs).toBe(GROK_SUMMARY_TIMEOUT_MS);
      expect(actualFirst.maxRetries).toBe(GROK_SUMMARY_MAX_RETRIES);
      expect(actualFirst.isTimeoutRetryable).toBe(false);
      for (const actualFollowUp of actualFollowUps) {
        expect(actualFollowUp.schemaName).toBe('digest_completion');
        expect(actualFollowUp).not.toHaveProperty('timeoutMs');
        expect(actualFollowUp).not.toHaveProperty('maxRetries');
        expect(actualFollowUp).not.toHaveProperty('isTimeoutRetryable');
      }
    });

    it('cuts a long translation to SUMMARY_POST_MAX_CHARS', async () => {
      // Arrange
      mockCompleteJson.mockResolvedValueOnce(summary(topic(['p1'])));
      const inputPost = { ...buildPost(1), translated: 'слово '.repeat(SUMMARY_POST_MAX_CHARS) };

      // Act
      await service.summarize([inputPost]);

      // Assert
      const actualText = mockCompleteJson.mock.calls[0][0].user.slice(
        '[p1] @fake_channel_1: '.length,
      );
      expect(actualText.length).toBeLessThanOrEqual(SUMMARY_POST_MAX_CHARS);
      expect(actualText.endsWith('…')).toBe(true);
    });

    it('rethrows a failure of the first request', async () => {
      // Arrange
      const inputError = new GrokError('HTTP 500', true);
      mockCompleteJson.mockRejectedValueOnce(inputError);

      // Act
      const actual = service.summarize([buildPost(1)]);

      // Assert
      await expect(actual).rejects.toBe(inputError);
      expect(mockCompleteJson).toHaveBeenCalledTimes(1);
    });
  });

  describe('coverage', () => {
    it('returns the topics as they are when the first answer covers every post', async () => {
      // Arrange
      mockCompleteJson.mockResolvedValueOnce(
        summary(
          {
            thesis: '  Первая тема.  ',
            viewpoints: [{ source: 'fake_channel_0', claim: 'x' }],
            refs: ['p1', 'p2'],
          },
          topic(['p3'], 'Вторая тема.'),
        ),
      );

      // Act
      const actual = await service.summarize([buildPost(1), buildPost(2), buildPost(3)]);

      // Assert
      expect(mockCompleteJson).toHaveBeenCalledTimes(1);
      expect(actual).toEqual({
        topics: [
          {
            thesis: 'Первая тема.',
            viewpoints: [{ source: 'fake_channel_0', claim: 'x' }],
            refs: ['p1', 'p2'],
            isFallback: false,
          },
          { thesis: 'Вторая тема.', viewpoints: [], refs: ['p3'], isFallback: false },
        ],
        fallbackTopicCount: 0,
      });
    });

    it('drops invented refs and topics made only of invented refs', async () => {
      // Arrange
      mockCompleteJson.mockResolvedValueOnce(
        summary(topic(['p1', 'p404']), topic(['p500', 'p501']), topic(['p2', 'p2'])),
      );

      // Act
      const actual = await service.summarize([buildPost(1), buildPost(2)]);

      // Assert
      expect(mockCompleteJson).toHaveBeenCalledTimes(1);
      expect(actual.topics.map((item) => item.refs)).toEqual([['p1'], ['p2']]);
    });

    it('asks a follow-up with the numbered theses and only the missing posts', async () => {
      // Arrange
      mockCompleteJson
        .mockResolvedValueOnce(summary(topic(['p1'], 'Тема один.'), topic(['p2'], 'Тема два.')))
        .mockResolvedValueOnce(coverage([{ topicNumber: 2, refs: ['p3'] }]));
      const inputPosts = [buildPost(1), buildPost(2), buildPost(3), buildPost(4, false)];

      // Act
      await service.summarize(inputPosts);

      // Assert
      expect(mockCompleteJson).toHaveBeenCalledTimes(2);
      const actualRequest = mockCompleteJson.mock.calls[1][0];
      expect(actualRequest).toEqual({
        system: SUMMARY_COVERAGE_SYSTEM_PROMPT,
        user: [
          'Topics:',
          '1. Тема один.',
          '2. Тема два.',
          '',
          'Left-out posts:',
          `[p3] @fake_channel_1: ${inputPosts[2].translated}`,
        ].join('\n'),
        schemaName: 'digest_completion',
        schema: COVERAGE_SCHEMA,
        isValid: isCoverageAnswer,
      });
    });

    it('adds refs by 1-based topic number, ignores invalid numbers and appends new topics', async () => {
      // Arrange
      mockCompleteJson
        .mockResolvedValueOnce(summary(topic(['p1']), topic(['p2'])))
        .mockResolvedValueOnce(
          coverage(
            [
              { topicNumber: 1, refs: ['p3'] },
              { topicNumber: 0, refs: ['p4'] },
              { topicNumber: TOPIC_NUMBER_OUT_OF_RANGE, refs: ['p4'] },
              { topicNumber: -1, refs: ['p4'] },
            ],
            [topic(['p5'], ' Новая тема. ')],
          ),
        )
        .mockResolvedValueOnce(coverage([{ topicNumber: 2, refs: ['p4'] }]));
      const inputPosts = [1, 2, 3, 4, 5].map((index) => buildPost(index));

      // Act
      const actual = await service.summarize(inputPosts);

      // Assert
      expect(mockCompleteJson).toHaveBeenCalledTimes(TOTAL_CALLS_WITH_RETRIES);
      expect(refsIn(mockCompleteJson.mock.calls[2][0].user)).toEqual(['p4']);
      expect(actual.topics).toEqual([
        { thesis: 'thesis p1', viewpoints: [], refs: ['p1', 'p3'], isFallback: false },
        { thesis: 'thesis p2', viewpoints: [], refs: ['p2', 'p4'], isFallback: false },
        { thesis: 'Новая тема.', viewpoints: [], refs: ['p5'], isFallback: false },
      ]);
      expect(actual.fallbackTopicCount).toBe(0);
    });

    it('drops invented refs returned by the follow-up', async () => {
      // Arrange
      mockCompleteJson
        .mockResolvedValueOnce(summary(topic(['p1'])))
        .mockResolvedValueOnce(
          coverage([{ topicNumber: 1, refs: ['p2', 'p77'] }], [topic(['p88'])]),
        );

      // Act
      const actual = await service.summarize([buildPost(1), buildPost(2)]);

      // Assert
      expect(actual.topics.map((item) => item.refs)).toEqual([['p1', 'p2']]);
    });

    it('keeps the topics when a follow-up fails and tries again', async () => {
      // Arrange
      mockCompleteJson
        .mockResolvedValueOnce(summary(topic(['p1'])))
        .mockRejectedValueOnce(new GrokError('timeout', true))
        .mockResolvedValueOnce(coverage([], [topic(['p2'])]));

      // Act
      const actual = await service.summarize([buildPost(1), buildPost(2)]);

      // Assert
      expect(mockCompleteJson).toHaveBeenCalledTimes(TOTAL_CALLS_WITH_RETRIES);
      expect(actual.topics.map((item) => item.refs)).toEqual([['p1'], ['p2']]);
      expect(actual.fallbackTopicCount).toBe(0);
    });

    it('builds a fallback topic for each post still missing after SUMMARY_COVERAGE_RETRIES', async () => {
      // Arrange
      const inputLong = {
        ...buildPost(3),
        translated: `${'длинное слово '.repeat(DIGEST_FALLBACK_THESIS_CHARS)}`,
      };
      mockCompleteJson
        .mockResolvedValueOnce(summary(topic(['p1'])))
        .mockResolvedValue(coverage([]));
      const inputPosts = [buildPost(1), buildPost(2), inputLong];

      // Act
      const actual = await service.summarize(inputPosts);

      // Assert
      expect(mockCompleteJson).toHaveBeenCalledTimes(TOTAL_CALLS_WITH_RETRIES);
      expect(actual.fallbackTopicCount).toBe(2);
      expect(actual.topics).toHaveLength(3);
      const [actualFallback2, actualFallback3] = actual.topics.slice(1);
      expect(actualFallback2).toEqual({
        thesis: inputPosts[1].translated,
        viewpoints: [],
        refs: ['p2'],
        isFallback: true,
      });
      expect(actualFallback3.refs).toEqual(['p3']);
      expect(actualFallback3.isFallback).toBe(true);
      expect(actualFallback3.thesis.length).toBeLessThanOrEqual(DIGEST_FALLBACK_THESIS_CHARS);
      expect(inputLong.translated.startsWith(actualFallback3.thesis.slice(0, -1))).toBe(true);
    });

    it('stops asking follow-ups as soon as coverage is complete', async () => {
      // Arrange
      mockCompleteJson
        .mockResolvedValueOnce(summary(topic(['p1'])))
        .mockResolvedValueOnce(coverage([{ topicNumber: 1, refs: ['p2'] }]));

      // Act
      await service.summarize([buildPost(1), buildPost(2)]);

      // Assert
      expect(mockCompleteJson).toHaveBeenCalledTimes(2);
    });
  });

  describe('coverage property: returned refs equal the refs of posts with text', () => {
    const inputPosts = [
      buildPost(1),
      buildPost(2),
      buildPost(3, false),
      buildPost(4),
      buildPost(5),
      buildPost(6, false),
    ];
    const expectedRefs = ['p1', 'p2', 'p4', 'p5'];

    const scenarios: Array<[string, unknown[]]> = [
      ['full coverage at once', [summary(topic(['p1', 'p2']), topic(['p4', 'p5']))]],
      ['empty topic list, follow-ups add nothing', [summary(), coverage([]), coverage([])]],
      [
        'all refs invented, including media-only refs',
        [summary(topic(['p9', 'p3']), topic(['p6'])), coverage([], [topic(['p42'])]), coverage([])],
      ],
      [
        'partial coverage fixed by a follow-up',
        [
          summary(topic(['p1'])),
          coverage([{ topicNumber: 1, refs: ['p2', 'p4'] }], [topic(['p5'])]),
        ],
      ],
      [
        'follow-ups fail',
        [summary(topic(['p2'])), new GrokError('HTTP 503', true), new GrokError('timeout', true)],
      ],
      [
        'duplicates across topics',
        [
          summary(topic(['p1', 'p2']), topic(['p2', 'p1']), topic(['p4', 'p4'])),
          coverage([], [topic(['p5', 'p1'])]),
        ],
      ],
      [
        'follow-up adds to invalid topic numbers only',
        [
          summary(topic(['p1'])),
          coverage([{ topicNumber: 0, refs: ['p2'] }]),
          coverage([{ topicNumber: 7, refs: ['p4'] }]),
        ],
      ],
    ];

    it.each(scenarios)('%s', async (_name, inputAnswers) => {
      // Arrange
      for (const answer of inputAnswers) {
        if (answer instanceof Error) {
          mockCompleteJson.mockRejectedValueOnce(answer);
        } else {
          mockCompleteJson.mockResolvedValueOnce(answer);
        }
      }

      // Act
      const actual = await service.summarize(inputPosts);

      // Assert
      expect(unionOfRefs(actual.topics)).toEqual(expectedRefs);
      expect(actual.topics.every((item) => item.refs.length > 0)).toBe(true);
      expect(actual.fallbackTopicCount).toBe(
        actual.topics.filter((item) => item.isFallback).length,
      );
      expect(mockCompleteJson.mock.calls.length).toBeLessThanOrEqual(TOTAL_CALLS_WITH_RETRIES);
    });
  });

  describe('logging', () => {
    it('logs one line with counts, the elapsed time and no post text', async () => {
      // Arrange
      jest.useFakeTimers({ now: BASE_DATE_MS });
      mockCompleteJson
        .mockImplementationOnce(async () => {
          jest.setSystemTime(BASE_DATE_MS + INPUT_ELAPSED_MS);
          return summary(topic(['p1']));
        })
        .mockResolvedValue(coverage([]));

      // Act
      await service.summarize([buildPost(1), buildPost(2)]);

      // Assert
      expect(logCallCount()).toBe(1);
      const actualLog = loggedText();
      expect(actualLog).toBe(
        `Summary: 2 topics from 2 posts, coverage retries=${SUMMARY_COVERAGE_RETRIES}, ` +
          `fallback=1, ${INPUT_ELAPSED_MS} ms`,
      );
      expect(actualLog).not.toContain(SECRET_MARKER);
      expect(actualLog).not.toContain(ORIGINAL_MARKER);
    });

    it('never logs post text when a follow-up fails', async () => {
      // Arrange
      mockCompleteJson
        .mockResolvedValueOnce(summary(topic(['p1'])))
        .mockRejectedValue(new GrokError('HTTP 500', true));

      // Act
      await service.summarize([buildPost(1), buildPost(2)]);

      // Assert
      expect(loggedText()).not.toContain(SECRET_MARKER);
      expect(loggedText()).not.toContain(ORIGINAL_MARKER);
    });
  });
});
