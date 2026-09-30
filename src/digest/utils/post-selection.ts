import { DIGEST_FALLBACK_THESIS_CHARS } from '../constants';
import type { DigestPost } from '../interfaces/digest-post.interface';
import type { DigestTopic, TranslatedPost } from '../interfaces/digest-topic.interface';
import { truncateText } from './text';

/**
 * Keeps the newest `maxPosts` posts in their collected order and reports how many were left out.
 * Collected order is per channel, oldest first, so the kept posts read the same way.
 */
export function limitPosts(
  posts: readonly DigestPost[],
  maxPosts: number,
): { kept: DigestPost[]; skippedCount: number } {
  if (posts.length <= maxPosts) {
    return { kept: [...posts], skippedCount: 0 };
  }
  const newest = [...posts].sort((left, right) => right.date.getTime() - left.date.getTime());
  const keptRefs = new Set(newest.slice(0, maxPosts).map((post) => post.ref));
  const kept = posts.filter((post) => keptRefs.has(post.ref));
  return { kept, skippedCount: posts.length - kept.length };
}

/** Every post with text as its own block: the digest when the summary could not be built. */
export function postsAsTopics(posts: readonly TranslatedPost[]): DigestTopic[] {
  return posts
    .filter((post) => post.hasText)
    .map((post) => ({
      thesis: truncateText(post.translated, DIGEST_FALLBACK_THESIS_CHARS),
      viewpoints: [],
      refs: [post.ref],
      isFallback: true,
    }));
}
