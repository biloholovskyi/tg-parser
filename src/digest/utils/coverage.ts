import type { DigestTopic } from '../interfaces/digest-topic.interface';

/**
 * Keeps only references from `knownRefs`, removes repeats inside a topic, and drops topics left
 * without a single known reference. The model can invent or repeat references; this is the check.
 */
export function dropUnknownRefs(
  topics: readonly DigestTopic[],
  knownRefs: ReadonlySet<string>,
): DigestTopic[] {
  return topics
    .map((topic) => ({
      ...topic,
      refs: [...new Set(topic.refs.filter((ref) => knownRefs.has(ref)))],
    }))
    .filter((topic) => topic.refs.length > 0);
}

/** References from `expectedRefs` that no topic mentions, in their original order. */
export function findMissingRefs(
  topics: readonly DigestTopic[],
  expectedRefs: readonly string[],
): string[] {
  const covered = new Set(topics.flatMap((topic) => topic.refs));
  return expectedRefs.filter((ref) => !covered.has(ref));
}
