import { Logger } from '@nestjs/common';
import {
  DIGEST_POST_MAX_CHARS,
  GROK_TRANSLATE_BATCH_CHARS,
  TRANSLATION_BUDGET_MS,
  TRANSLATION_MISSING_RETRIES,
} from './constants';
import { GrokClient, GrokError } from './grok/grok.client';
import type { GrokJsonRequest } from './grok/grok.client';
import { TRANSLATION_SYSTEM_PROMPT } from './grok/prompts';
import { TRANSLATION_SCHEMA, isTranslationAnswer } from './grok/schemas';
import type { TranslationAnswer } from './grok/schemas';
import type { DigestPost } from './interfaces/digest-post.interface';
import { TranslationService } from './translation.service';

type CompleteJson = jest.Mock<Promise<unknown>, [GrokJsonRequest<unknown>]>;

const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const REF_PATTERN = /^\[(p\d+)\] /gm;
const BASE_DATE_MS = Date.UTC(2026, 0, 1);
/** Posts at the per-post cap; enough of them to need more than one batch. */
const LONG_POST_COUNT = Math.ceil((2 * GROK_TRANSLATE_BATCH_CHARS) / DIGEST_POST_MAX_CHARS) + 1;
const SECRET_MARKER = 'SECRET-POST-BODY';
/** Fake time one Grok call takes in the log-line test. */
const INPUT_ELAPSED_MS = 1234;

function buildPost(index: number, text = `fake original ${index} ${SECRET_MARKER}`): DigestPost {
  return {
    ref: `p${index}`,
    channel: 'fake_channel',
    url: `https://t.me/fake_channel/${index}`,
    text,
    date: new Date(BASE_DATE_MS + index),
    hasText: text.length > 0,
  };
}

/** Posts at the per-post cap with distinct texts; they need more than two batches. */
function buildLongPosts(): DigestPost[] {
  return Array.from({ length: LONG_POST_COUNT }, (_, index) =>
    buildPost(index + 1, `${'x'.repeat(DIGEST_POST_MAX_CHARS - 1)}${index}`),
  );
}

function buildMediaPost(index: number): DigestPost {
  return { ...buildPost(index, ''), hasText: false };
}

function refsIn(user: string): string[] {
  return [...user.matchAll(REF_PATTERN)].map((match) => match[1]);
}

function translationOf(ref: string): string {
  return `перевод ${ref}`;
}

/** Answers every requested ref, except those in `skip`. */
function answerAll(
  skip: ReadonlySet<string> = new Set(),
): (request: GrokJsonRequest<unknown>) => Promise<TranslationAnswer> {
  return async (request) => ({
    translations: refsIn(request.user)
      .filter((ref) => !skip.has(ref))
      .map((ref) => ({ ref, text: translationOf(ref) })),
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('TranslationService', () => {
  let mockCompleteJson: CompleteJson;
  let loggerSpies: jest.SpyInstance[];
  let service: TranslationService;

  function loggedText(): string {
    return loggerSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => String(arg))
      .join('\n');
  }

  function logCallCount(): number {
    return loggerSpies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
  }

  function requestedRefs(callIndex: number): string[] {
    return refsIn(mockCompleteJson.mock.calls[callIndex][0].user);
  }

  beforeEach(() => {
    mockCompleteJson = jest.fn();
    loggerSpies = LOGGER_LEVELS.map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    service = new TranslationService({ completeJson: mockCompleteJson } as unknown as GrokClient);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('asks Grok with the translation prompt, schema and guard', async () => {
    // Arrange
    mockCompleteJson.mockImplementation(answerAll());

    // Act
    await service.translate([buildPost(1)]);

    // Assert
    expect(mockCompleteJson).toHaveBeenCalledWith({
      system: TRANSLATION_SYSTEM_PROMPT,
      user: `[p1] ${buildPost(1).text}`,
      schemaName: 'translations',
      schema: TRANSLATION_SCHEMA,
      isValid: isTranslationAnswer,
    });
  });

  it('translates every post with text and reports no untranslated posts', async () => {
    // Arrange
    mockCompleteJson.mockImplementation(answerAll());
    const inputPosts = [buildPost(1), buildPost(2), buildPost(3)];

    // Act
    const actual = await service.translate(inputPosts);

    // Assert
    expect(actual.untranslatedCount).toBe(0);
    expect(actual.posts).toEqual(
      inputPosts.map((post) => ({
        ...post,
        translated: translationOf(post.ref),
        isUntranslated: false,
      })),
    );
  });

  it('never sends media-only posts and leaves them unflagged', async () => {
    // Arrange
    mockCompleteJson.mockImplementation(answerAll());
    const inputPosts = [buildMediaPost(1), buildPost(2), buildMediaPost(3)];

    // Act
    const actual = await service.translate(inputPosts);

    // Assert
    expect(mockCompleteJson).toHaveBeenCalledTimes(1);
    expect(requestedRefs(0)).toEqual(['p2']);
    expect(actual.posts[0]).toEqual({ ...inputPosts[0], translated: '', isUntranslated: false });
    expect(actual.posts[2].isUntranslated).toBe(false);
    expect(actual.posts.map((post) => post.ref)).toEqual(['p1', 'p2', 'p3']);
  });

  it('makes no request when no post has text', async () => {
    // Act
    const actual = await service.translate([buildMediaPost(1), buildMediaPost(2)]);

    // Assert
    expect(mockCompleteJson).not.toHaveBeenCalled();
    expect(actual.untranslatedCount).toBe(0);
  });

  it('cuts a long post to DIGEST_POST_MAX_CHARS before sending it', async () => {
    // Arrange
    mockCompleteJson.mockImplementation(answerAll());
    const inputPost = buildPost(1, 'word '.repeat(DIGEST_POST_MAX_CHARS));

    // Act
    await service.translate([inputPost]);

    // Assert
    const actualUser = mockCompleteJson.mock.calls[0][0].user;
    const actualText = actualUser.slice('[p1] '.length);
    expect(actualText.length).toBeLessThanOrEqual(DIGEST_POST_MAX_CHARS);
    expect(actualText.endsWith('…')).toBe(true);
  });

  it('splits posts into batches within GROK_TRANSLATE_BATCH_CHARS, keeping order and every ref', async () => {
    // Arrange
    mockCompleteJson.mockImplementation(answerAll());
    const inputPosts = Array.from({ length: LONG_POST_COUNT }, (_, index) =>
      buildPost(index + 1, 'x'.repeat(DIGEST_POST_MAX_CHARS)),
    );

    // Act
    const actual = await service.translate(inputPosts);

    // Assert
    const actualBatches = mockCompleteJson.mock.calls.map(([request]) => request.user);
    expect(actualBatches.length).toBeGreaterThan(2);
    for (const user of actualBatches) {
      const inputSizes = user.split('\n\n').reduce((sum, part) => sum + part.length, 0);
      expect(inputSizes).toBeLessThanOrEqual(GROK_TRANSLATE_BATCH_CHARS);
    }
    expect(actualBatches.flatMap(refsIn)).toEqual(inputPosts.map((post) => post.ref));
    expect(actual.untranslatedCount).toBe(0);
  });

  it('sends batches one at a time', async () => {
    // Arrange
    const gate = deferred<TranslationAnswer>();
    mockCompleteJson.mockReturnValueOnce(gate.promise).mockImplementation(answerAll());
    const inputPosts = Array.from({ length: LONG_POST_COUNT }, (_, index) =>
      buildPost(index + 1, 'x'.repeat(DIGEST_POST_MAX_CHARS)),
    );

    // Act
    const pending = service.translate(inputPosts);
    await new Promise(setImmediate);
    const actualCallsWhileFirstPending = mockCompleteJson.mock.calls.length;
    gate.resolve(await answerAll()(mockCompleteJson.mock.calls[0][0]));
    await pending;

    // Assert
    expect(actualCallsWhileFirstPending).toBe(1);
    expect(mockCompleteJson.mock.calls.length).toBeGreaterThan(1);
  });

  it('ignores answers for refs that were not requested and blank translations', async () => {
    // Arrange
    mockCompleteJson.mockResolvedValue({
      translations: [
        { ref: 'p1', text: '  перевод p1  ' },
        { ref: 'p2', text: '   ' },
        { ref: 'p99', text: 'выдумано' },
      ],
    });
    const inputPosts = [buildPost(1), buildPost(2)];

    // Act
    const actual = await service.translate(inputPosts);

    // Assert
    expect(actual.posts.map((post) => post.ref)).toEqual(['p1', 'p2']);
    expect(actual.posts[0].translated).toBe('перевод p1');
    expect(actual.posts[1]).toEqual({
      ...inputPosts[1],
      translated: inputPosts[1].text,
      isUntranslated: true,
    });
    expect(actual.untranslatedCount).toBe(1);
  });

  it('asks again only for the refs the model skipped and uses the retry answer', async () => {
    // Arrange
    mockCompleteJson
      .mockImplementationOnce(answerAll(new Set(['p2'])))
      .mockImplementation(answerAll());
    const inputPosts = [buildPost(1), buildPost(2), buildPost(3)];

    // Act
    const actual = await service.translate(inputPosts);

    // Assert
    expect(mockCompleteJson).toHaveBeenCalledTimes(2);
    expect(requestedRefs(1)).toEqual(['p2']);
    expect(actual.posts[1].translated).toBe(translationOf('p2'));
    expect(actual.untranslatedCount).toBe(0);
  });

  it('stops after TRANSLATION_MISSING_RETRIES and keeps the original text with a flag', async () => {
    // Arrange
    mockCompleteJson.mockImplementation(answerAll(new Set(['p2'])));
    const inputPosts = [buildPost(1), buildPost(2)];

    // Act
    const actual = await service.translate(inputPosts);

    // Assert
    expect(mockCompleteJson).toHaveBeenCalledTimes(1 + TRANSLATION_MISSING_RETRIES);
    expect(actual.posts[1]).toEqual({
      ...inputPosts[1],
      translated: inputPosts[1].text,
      isUntranslated: true,
    });
    expect(actual.posts[0].isUntranslated).toBe(false);
    expect(actual.untranslatedCount).toBe(1);
  });

  it('translates every batch when every request succeeds', async () => {
    // Arrange
    mockCompleteJson.mockImplementation(answerAll());
    const inputPosts = buildLongPosts();

    // Act
    const actual = await service.translate(inputPosts);

    // Assert
    expect(mockCompleteJson.mock.calls.length).toBeGreaterThan(2);
    expect(mockCompleteJson.mock.calls.flatMap(([request]) => refsIn(request.user))).toEqual(
      inputPosts.map((post) => post.ref),
    );
    for (const post of actual.posts) {
      expect(post.isUntranslated).toBe(false);
      expect(post.translated).toBe(translationOf(post.ref));
    }
    expect(actual.untranslatedCount).toBe(0);
  });

  it('stops at the first failed batch: later batches are not requested and stay untranslated', async () => {
    // Arrange
    mockCompleteJson
      .mockImplementationOnce(answerAll())
      .mockRejectedValueOnce(new GrokError('HTTP 500', true))
      .mockImplementation(answerAll());
    const inputPosts = buildLongPosts();

    // Act
    const actual = await service.translate(inputPosts);

    // Assert
    expect(mockCompleteJson).toHaveBeenCalledTimes(2);
    const actualTranslatedRefs = new Set(requestedRefs(0));
    expect(actualTranslatedRefs.size).toBeGreaterThan(0);
    for (const post of actual.posts) {
      const isTranslated = actualTranslatedRefs.has(post.ref);
      expect(post.isUntranslated).toBe(!isTranslated);
      expect(post.translated).toBe(isTranslated ? translationOf(post.ref) : post.text);
    }
    expect(actual.untranslatedCount).toBe(inputPosts.length - actualTranslatedRefs.size);
  });

  it('keeps every post in the original language without throwing when the first batch fails', async () => {
    // Arrange
    mockCompleteJson
      .mockRejectedValueOnce(new GrokError('HTTP 500', true))
      .mockImplementation(answerAll());
    const inputPosts = [...buildLongPosts(), buildMediaPost(LONG_POST_COUNT + 1)];

    // Act
    const actual = await service.translate(inputPosts);

    // Assert
    expect(mockCompleteJson).toHaveBeenCalledTimes(1);
    expect(actual.posts.map((post) => post.translated)).toEqual(
      inputPosts.map((post) => post.text),
    );
    expect(actual.posts.at(-1)?.isUntranslated).toBe(false);
    expect(actual.untranslatedCount).toBe(LONG_POST_COUNT);
  });

  it('stops further batches when the follow-up for missing refs fails', async () => {
    // Arrange
    mockCompleteJson
      .mockImplementationOnce(answerAll(new Set(['p1'])))
      .mockRejectedValueOnce(new GrokError('timeout', true))
      .mockImplementation(answerAll());
    const inputPosts = buildLongPosts();

    // Act
    const actual = await service.translate(inputPosts);

    // Assert
    expect(TRANSLATION_MISSING_RETRIES).toBeGreaterThan(0);
    expect(mockCompleteJson).toHaveBeenCalledTimes(2);
    expect(requestedRefs(1)).toEqual(['p1']);
    const actualFirstBatch = new Set(requestedRefs(0));
    for (const post of actual.posts) {
      const isTranslated = actualFirstBatch.has(post.ref) && post.ref !== 'p1';
      expect(post.isUntranslated).toBe(!isTranslated);
    }
    expect(actual.untranslatedCount).toBe(inputPosts.length - (actualFirstBatch.size - 1));
  });

  describe('TRANSLATION_BUDGET_MS deadline', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: BASE_DATE_MS });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    /** First batch answers after the clock moved `elapsedMs` past the start of translate. */
    function answerFirstAfter(elapsedMs: number): void {
      mockCompleteJson
        .mockImplementationOnce(async (request) => {
          jest.setSystemTime(BASE_DATE_MS + elapsedMs);
          return answerAll()(request);
        })
        .mockImplementation(answerAll());
    }

    it('starts no new batch once the budget has passed during the first batch', async () => {
      // Arrange
      answerFirstAfter(TRANSLATION_BUDGET_MS + 1);
      const inputPosts = buildLongPosts();

      // Act
      const actual = await service.translate(inputPosts);

      // Assert
      expect(mockCompleteJson).toHaveBeenCalledTimes(1);
      const actualFirstBatch = new Set(requestedRefs(0));
      for (const post of actual.posts) {
        expect(post.isUntranslated).toBe(!actualFirstBatch.has(post.ref));
      }
      expect(actual.untranslatedCount).toBe(inputPosts.length - actualFirstBatch.size);
    });

    it('stops exactly at the budget boundary', async () => {
      // Arrange
      answerFirstAfter(TRANSLATION_BUDGET_MS);

      // Act
      await service.translate(buildLongPosts());

      // Assert
      expect(mockCompleteJson).toHaveBeenCalledTimes(1);
    });

    it('keeps going while the budget has not yet passed', async () => {
      // Arrange
      answerFirstAfter(TRANSLATION_BUDGET_MS - 1);

      // Act
      const actual = await service.translate(buildLongPosts());

      // Assert
      expect(mockCompleteJson.mock.calls.length).toBeGreaterThan(2);
      expect(actual.untranslatedCount).toBe(0);
    });
  });

  it('keeps translations from the first answer when the follow-up request fails', async () => {
    // Arrange
    mockCompleteJson
      .mockImplementationOnce(answerAll(new Set(['p2'])))
      .mockRejectedValueOnce(new GrokError('timeout', true));
    const inputPosts = [buildPost(1), buildPost(2)];

    // Act
    const actual = await service.translate(inputPosts);

    // Assert
    expect(actual.posts[0].translated).toBe(translationOf('p1'));
    expect(actual.posts[1].isUntranslated).toBe(true);
    expect(actual.untranslatedCount).toBe(1);
  });

  it('logs one line with counts and the elapsed time only, never post text', async () => {
    // Arrange
    jest.useFakeTimers({ now: BASE_DATE_MS });
    const skipRefs = new Set(['p2']);
    mockCompleteJson
      .mockImplementationOnce(async (request) => {
        jest.setSystemTime(BASE_DATE_MS + INPUT_ELAPSED_MS);
        return answerAll(skipRefs)(request);
      })
      .mockImplementation(answerAll(skipRefs));
    const inputPosts = [buildPost(1), buildPost(2), buildMediaPost(3)];

    // Act
    await service.translate(inputPosts);

    // Assert
    expect(logCallCount()).toBe(1);
    const actualLog = loggedText();
    expect(actualLog).toBe(`Translated 1 of 2 posts in 1 batches, ${INPUT_ELAPSED_MS} ms`);
    expect(actualLog).not.toContain(SECRET_MARKER);
    expect(actualLog).not.toContain('перевод');
  });

  it('never logs post text when every request fails', async () => {
    // Arrange
    mockCompleteJson.mockRejectedValue(new GrokError('HTTP 503', true));

    // Act
    const actual = await service.translate([buildPost(1), buildPost(2)]);

    // Assert
    expect(actual.untranslatedCount).toBe(2);
    expect(loggedText()).not.toContain(SECRET_MARKER);
  });
});
