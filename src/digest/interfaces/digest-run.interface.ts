import type { CollectedPosts } from './digest-post.interface';
import type { DigestTopic, TranslatedPost } from './digest-topic.interface';

/** Body of `POST /digest/run`: the run has started; the digest arrives in the bot. */
export interface DigestRunResponse {
  status: 'started';
}

export type DigestTrigger = 'scheduled' | 'manual';

/** Everything the formatter needs to render one run. */
export interface DigestReport {
  runAt: Date;
  timezone: string;
  collected: CollectedPosts;
  /** Posts that went into the digest, after the DIGEST_MAX_POSTS ceiling. */
  posts: TranslatedPost[];
  topics: DigestTopic[];
  /** Posts left out by the DIGEST_MAX_POSTS ceiling. */
  skippedPostCount: number;
  untranslatedCount: number;
  fallbackTopicCount: number;
  /** True when the summary failed and every post is listed as its own block. */
  isSummaryFallback: boolean;
}

/** Outcome of one run, written as a single log line. */
export interface DigestRunResult {
  trigger: DigestTrigger;
  postCount: number;
  topicCount: number;
  channelCount: number;
  messageCount: number;
  durationMs: number;
}
