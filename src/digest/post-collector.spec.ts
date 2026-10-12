import {
  BadGatewayException,
  BadRequestException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { TooManyRequestsException } from '../shared/exceptions/too-many-requests.exception';
import type { GetPostsResponse, TelegramPost } from '../telegram/interfaces/message.interface';
import { TelegramService } from '../telegram/telegram.service';
import { DIGEST_POST_MAX_CHARS, POST_REF_PREFIX } from './constants';
import { PostCollector } from './post-collector';

/** The real facade loads GramJS at import time; the collector only needs the class token. */
jest.mock('../telegram/telegram.service', () => ({ TelegramService: class {} }));

type ReadPosts = jest.Mock<Promise<GetPostsResponse>, [string, number]>;

const INPUT_HOURS_BACK = 24;
const INPUT_FLOOD_SECONDS = 30;
const BASE_DATE_MS = Date.UTC(2026, 0, 1);
const MINUTE_MS = 60_000;
const inputChannelA = 'fake_channel_a';
const inputChannelB = 'fake_channel_b';
const inputChannelC = 'fake_channel_c';
const inputSecretText = 'fake private post body';

const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;

function buildPost(id: number, minutesAfterBase: number, text = `fake post ${id}`): TelegramPost {
  return {
    id,
    text,
    date: new Date(BASE_DATE_MS + minutesAfterBase * MINUTE_MS),
    media: [],
    postUrl: `https://t.me/fake/${id}`,
  };
}

function buildResponse(posts: TelegramPost[], isTruncated = false): GetPostsResponse {
  return { posts, count: posts.length, isTruncated };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('PostCollector', () => {
  let mockReadPosts: ReadPosts;
  let collector: PostCollector;
  let loggerSpies: jest.SpyInstance[];

  function loggedText(): string {
    return loggerSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((argument) => (typeof argument === 'string' ? argument : JSON.stringify(argument)))
      .join(' | ');
  }

  function logLineCount(): number {
    return loggerSpies.reduce((total, spy) => total + spy.mock.calls.length, 0);
  }

  beforeEach(() => {
    mockReadPosts = jest.fn();
    const mockTelegram = { readPostsAsDigestAccount: mockReadPosts };
    collector = new PostCollector(mockTelegram as unknown as TelegramService);
    loggerSpies = LOGGER_LEVELS.map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('collects every channel with the given window, oldest post first per channel', async () => {
    // Arrange
    mockReadPosts
      .mockResolvedValueOnce(buildResponse([buildPost(2, 20), buildPost(1, 10)]))
      .mockResolvedValueOnce(buildResponse([buildPost(3, 5)]));

    // Act
    const actualResult = await collector.collect([inputChannelA, inputChannelB], INPUT_HOURS_BACK);

    // Assert
    expect(mockReadPosts.mock.calls).toEqual([
      [inputChannelA, INPUT_HOURS_BACK],
      [inputChannelB, INPUT_HOURS_BACK],
    ]);
    expect(actualResult.posts.map((post) => [post.channel, post.url])).toEqual([
      [inputChannelA, 'https://t.me/fake/1'],
      [inputChannelA, 'https://t.me/fake/2'],
      [inputChannelB, 'https://t.me/fake/3'],
    ]);
    expect(actualResult.channelCount).toBe(2);
    expect(actualResult.unavailableChannels).toEqual([]);
    expect(actualResult.truncatedChannels).toEqual([]);
  });

  it('numbers refs p1, p2, ... across channels in collection order', async () => {
    // Arrange
    mockReadPosts
      .mockResolvedValueOnce(buildResponse([buildPost(2, 20), buildPost(1, 10)]))
      .mockResolvedValueOnce(buildResponse([]))
      .mockResolvedValueOnce(buildResponse([buildPost(3, 5)]));

    // Act
    const actualResult = await collector.collect(
      [inputChannelA, inputChannelB, inputChannelC],
      INPUT_HOURS_BACK,
    );

    // Assert
    expect(actualResult.posts.map((post) => post.ref)).toEqual([
      `${POST_REF_PREFIX}1`,
      `${POST_REF_PREFIX}2`,
      `${POST_REF_PREFIX}3`,
    ]);
    expect(actualResult.posts[2].channel).toBe(inputChannelC);
  });

  it('maps text, url and date and does not mutate the facade result', async () => {
    // Arrange
    const inputPosts = [buildPost(2, 20), buildPost(1, 10, '  padded text \n')];
    mockReadPosts.mockResolvedValueOnce(buildResponse(inputPosts));
    const expectedOrder = inputPosts.map((post) => post.id);

    // Act
    const actualResult = await collector.collect([inputChannelA], INPUT_HOURS_BACK);

    // Assert
    expect(actualResult.posts[0]).toEqual({
      ref: `${POST_REF_PREFIX}1`,
      channel: inputChannelA,
      url: 'https://t.me/fake/1',
      text: 'padded text',
      date: inputPosts[1].date,
      hasText: true,
    });
    expect(inputPosts.map((post) => post.id)).toEqual(expectedOrder);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', ' \n\t '],
  ])(
    'marks a media-only post with %s text as hasText false and keeps it',
    async (_l, inputText) => {
      // Arrange
      const inputPost = { ...buildPost(1, 0, inputText), media: [{ type: 'photo' as const }] };
      mockReadPosts.mockResolvedValueOnce(buildResponse([inputPost]));

      // Act
      const actualResult = await collector.collect([inputChannelA], INPUT_HOURS_BACK);

      // Assert
      expect(actualResult.posts).toHaveLength(1);
      expect(actualResult.posts[0].text).toBe('');
      expect(actualResult.posts[0].hasText).toBe(false);
      expect(actualResult.posts[0].url).toBe(inputPost.postUrl);
    },
  );

  it('cuts a long post to at most DIGEST_POST_MAX_CHARS at collection', async () => {
    // Arrange
    const inputText = `  ${'word '.repeat(DIGEST_POST_MAX_CHARS)}  `;
    mockReadPosts.mockResolvedValueOnce(buildResponse([buildPost(1, 0, inputText)]));

    // Act
    const actualResult = await collector.collect([inputChannelA], INPUT_HOURS_BACK);

    // Assert
    const actualText = actualResult.posts[0].text;
    expect(actualText.length).toBeLessThanOrEqual(DIGEST_POST_MAX_CHARS);
    expect(actualText.endsWith('…')).toBe(true);
    expect(actualText.startsWith('word')).toBe(true);
    expect(actualResult.posts[0].hasText).toBe(true);
  });

  it('keeps a post of exactly DIGEST_POST_MAX_CHARS and a short post unchanged', async () => {
    // Arrange
    const inputExactText = 'x'.repeat(DIGEST_POST_MAX_CHARS);
    const inputShortText = 'fake short post';
    mockReadPosts.mockResolvedValueOnce(
      buildResponse([buildPost(1, 0, inputExactText), buildPost(2, 1, inputShortText)]),
    );

    // Act
    const actualResult = await collector.collect([inputChannelA], INPUT_HOURS_BACK);

    // Assert
    expect(actualResult.posts.map((post) => post.text)).toEqual([inputExactText, inputShortText]);
  });

  it('reports a truncated channel and still keeps its posts', async () => {
    // Arrange
    mockReadPosts
      .mockResolvedValueOnce(buildResponse([buildPost(1, 0)], true))
      .mockResolvedValueOnce(buildResponse([buildPost(2, 0)]));

    // Act
    const actualResult = await collector.collect([inputChannelA, inputChannelB], INPUT_HOURS_BACK);

    // Assert
    expect(actualResult.truncatedChannels).toEqual([inputChannelA]);
    expect(actualResult.posts).toHaveLength(2);
  });

  it.each([
    ['404 channel not found', new NotFoundException('fake not found')],
    ['502 other Telegram failure', new BadGatewayException('fake failed')],
    ['400 bad request', new BadRequestException('fake bad request')],
  ])('skips a channel failing with %s and continues', async (_label, inputError) => {
    // Arrange
    mockReadPosts
      .mockResolvedValueOnce(buildResponse([buildPost(1, 0)]))
      .mockRejectedValueOnce(inputError)
      .mockResolvedValueOnce(buildResponse([buildPost(3, 0)]));

    // Act
    const actualResult = await collector.collect(
      [inputChannelA, inputChannelB, inputChannelC],
      INPUT_HOURS_BACK,
    );

    // Assert
    expect(actualResult.unavailableChannels).toEqual([inputChannelB]);
    expect(actualResult.posts.map((post) => post.channel)).toEqual([inputChannelA, inputChannelC]);
    expect(actualResult.posts.map((post) => post.ref)).toEqual([
      `${POST_REF_PREFIX}1`,
      `${POST_REF_PREFIX}2`,
    ]);
    expect(actualResult.channelCount).toBe(3);
    expect(mockReadPosts).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['401 session missing or rejected', new UnauthorizedException('fake unauthorized')],
    ['429 flood wait', new TooManyRequestsException(INPUT_FLOOD_SECONDS)],
    ['503 transport failure', new ServiceUnavailableException('fake unreachable')],
    ['a non-HTTP error', new Error('fake unexpected')],
  ])('aborts the whole run on %s without reading further channels', async (_label, inputError) => {
    // Arrange
    mockReadPosts
      .mockResolvedValueOnce(buildResponse([buildPost(1, 0)]))
      .mockRejectedValueOnce(inputError);

    // Act
    const actualResult = collector.collect(
      [inputChannelA, inputChannelB, inputChannelC],
      INPUT_HOURS_BACK,
    );

    // Assert
    await expect(actualResult).rejects.toBe(inputError);
    expect(mockReadPosts).toHaveBeenCalledTimes(2);
  });

  it('requests the next channel only after the previous one has resolved', async () => {
    // Arrange
    const firstGate = deferred<GetPostsResponse>();
    const secondGate = deferred<GetPostsResponse>();
    mockReadPosts.mockReturnValueOnce(firstGate.promise).mockReturnValueOnce(secondGate.promise);

    // Act
    const actualResult = collector.collect([inputChannelA, inputChannelB], INPUT_HOURS_BACK);
    await Promise.resolve();
    await Promise.resolve();
    const actualCallsWhileFirstPending = mockReadPosts.mock.calls.length;
    firstGate.resolve(buildResponse([buildPost(1, 0)]));
    await new Promise((settle) => setImmediate(settle));
    const actualCallsAfterFirst = mockReadPosts.mock.calls.length;
    secondGate.resolve(buildResponse([buildPost(2, 0)]));
    const actualCollected = await actualResult;

    // Assert
    expect(actualCallsWhileFirstPending).toBe(1);
    expect(actualCallsAfterFirst).toBe(2);
    expect(mockReadPosts.mock.calls[1][0]).toBe(inputChannelB);
    expect(actualCollected.posts).toHaveLength(2);
  });

  it('does not start the next channel while a failing channel is still pending', async () => {
    // Arrange
    const firstGate = deferred<GetPostsResponse>();
    mockReadPosts
      .mockReturnValueOnce(firstGate.promise.then(() => Promise.reject(new NotFoundException())))
      .mockResolvedValueOnce(buildResponse([]));

    // Act
    const actualResult = collector.collect([inputChannelA, inputChannelB], INPUT_HOURS_BACK);
    await new Promise((settle) => setImmediate(settle));
    const actualCallsWhilePending = mockReadPosts.mock.calls.length;
    firstGate.resolve(buildResponse([]));
    const actualCollected = await actualResult;

    // Assert
    expect(actualCallsWhilePending).toBe(1);
    expect(actualCollected.unavailableChannels).toEqual([inputChannelA]);
  });

  it('returns an empty result for an empty channel list without calling Telegram', async () => {
    // Act
    const actualResult = await collector.collect([], INPUT_HOURS_BACK);

    // Assert
    expect(actualResult).toEqual({
      posts: [],
      channelCount: 0,
      unavailableChannels: [],
      truncatedChannels: [],
    });
    expect(mockReadPosts).not.toHaveBeenCalled();
  });

  it('logs one outcome line with counts only, never post text or channel names', async () => {
    // Arrange
    mockReadPosts
      .mockResolvedValueOnce(buildResponse([buildPost(1, 0, inputSecretText)], true))
      .mockRejectedValueOnce(new NotFoundException('fake not found'));

    // Act
    await collector.collect([inputChannelA, inputChannelB], INPUT_HOURS_BACK);

    // Assert
    expect(logLineCount()).toBe(1);
    const actualText = loggedText();
    expect(actualText).toContain('1 posts');
    expect(actualText).toContain('2 channels');
    expect(actualText).toContain('unavailable=1');
    expect(actualText).toContain('truncated=1');
    expect(actualText).not.toContain(inputSecretText);
    expect(actualText).not.toContain(inputChannelA);
    expect(actualText).not.toContain(inputChannelB);
  });
});
