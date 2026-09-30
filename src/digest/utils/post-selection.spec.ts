import { DIGEST_FALLBACK_THESIS_CHARS } from '../constants';
import type { DigestPost } from '../interfaces/digest-post.interface';
import type { TranslatedPost } from '../interfaces/digest-topic.interface';
import { limitPosts, postsAsTopics } from './post-selection';

const BASE_DATE_MS = Date.UTC(2026, 0, 1);
const MINUTE_MS = 60_000;

function buildPost(ref: string, minutes: number, channel = 'fake_channel'): DigestPost {
  return {
    ref,
    channel,
    url: `https://t.me/${channel}/${ref}`,
    text: `fake text ${ref}`,
    date: new Date(BASE_DATE_MS + minutes * MINUTE_MS),
    hasText: true,
  };
}

function buildTranslated(ref: string, translated: string, hasText = true): TranslatedPost {
  return {
    ...buildPost(ref, 0),
    text: hasText ? `fake original ${ref}` : '',
    hasText,
    translated,
    isUntranslated: false,
  };
}

describe('limitPosts', () => {
  it('keeps every post and skips none when within the limit', () => {
    // Arrange
    const inputPosts = [buildPost('p1', 1), buildPost('p2', 2)];

    // Act
    const actualResult = limitPosts(inputPosts, inputPosts.length);

    // Assert
    expect(actualResult.kept).toEqual(inputPosts);
    expect(actualResult.kept).not.toBe(inputPosts);
    expect(actualResult.skippedCount).toBe(0);
  });

  it('keeps the newest posts across channels in their collected order and counts the rest', () => {
    // Arrange: collected per channel, oldest first.
    const inputPosts = [
      buildPost('p1', 1, 'fake_a'),
      buildPost('p2', 50, 'fake_a'),
      buildPost('p3', 5, 'fake_b'),
      buildPost('p4', 40, 'fake_b'),
      buildPost('p5', 30, 'fake_b'),
    ];
    const inputMax = 3;

    // Act
    const actualResult = limitPosts(inputPosts, inputMax);

    // Assert
    expect(actualResult.kept.map((post) => post.ref)).toEqual(['p2', 'p4', 'p5']);
    expect(actualResult.skippedCount).toBe(inputPosts.length - inputMax);
  });

  it('keeps nothing when the limit is zero', () => {
    // Act
    const actualResult = limitPosts([buildPost('p1', 1)], 0);

    // Assert
    expect(actualResult).toEqual({ kept: [], skippedCount: 1 });
  });
});

describe('postsAsTopics', () => {
  it('turns every text post into its own fallback topic and skips media-only posts', () => {
    // Arrange
    const inputPosts = [
      buildTranslated('p1', 'перевод один'),
      buildTranslated('p2', '', false),
      buildTranslated('p3', 'перевод три'),
    ];

    // Act
    const actualTopics = postsAsTopics(inputPosts);

    // Assert
    expect(actualTopics).toEqual([
      { thesis: 'перевод один', viewpoints: [], refs: ['p1'], isFallback: true },
      { thesis: 'перевод три', viewpoints: [], refs: ['p3'], isFallback: true },
    ]);
  });

  it('cuts a long translation to DIGEST_FALLBACK_THESIS_CHARS', () => {
    // Arrange
    const inputPosts = [buildTranslated('p1', 'слово '.repeat(DIGEST_FALLBACK_THESIS_CHARS))];

    // Act
    const [actualTopic] = postsAsTopics(inputPosts);

    // Assert
    expect(actualTopic.thesis.length).toBeLessThanOrEqual(DIGEST_FALLBACK_THESIS_CHARS);
    expect(actualTopic.thesis.endsWith('…')).toBe(true);
  });
});
