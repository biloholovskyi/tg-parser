import { Injectable, Logger } from '@nestjs/common';
import {
  DIGEST_FALLBACK_THESIS_CHARS,
  SUMMARY_COVERAGE_RETRIES,
  SUMMARY_POST_MAX_CHARS,
} from './constants';
import { GrokClient } from './grok/grok.client';
import { SUMMARY_COVERAGE_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from './grok/prompts';
import { COVERAGE_SCHEMA, SUMMARY_SCHEMA, isCoverageAnswer, isSummaryAnswer } from './grok/schemas';
import type { CoverageAnswer, TopicAnswer } from './grok/schemas';
import type {
  DigestTopic,
  SummaryResult,
  TranslatedPost,
} from './interfaces/digest-topic.interface';
import { dropUnknownRefs, findMissingRefs } from './utils/coverage';
import { truncateText } from './utils/text';

/**
 * Folds translated posts into topics and guarantees coverage: every post with text ends up in at
 * least one topic, through follow-up requests and, as the last resort, a block of its own.
 * A failure of the first request is thrown; the caller decides how to deliver without a summary.
 */
@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);

  constructor(private readonly grok: GrokClient) {}

  async summarize(posts: readonly TranslatedPost[]): Promise<SummaryResult> {
    const withText = posts.filter((post) => post.hasText);
    if (withText.length === 0) {
      return { topics: [], fallbackTopicCount: 0 };
    }
    const refs = withText.map((post) => post.ref);
    const knownRefs = new Set(refs);
    let topics = dropUnknownRefs(await this.requestSummary(withText), knownRefs);
    let retries = 0;
    for (; retries < SUMMARY_COVERAGE_RETRIES; retries++) {
      const missing = findMissingRefs(topics, refs);
      if (missing.length === 0) {
        break;
      }
      topics = dropUnknownRefs(await this.placeMissing(topics, withText, missing), knownRefs);
    }
    const fallback = findMissingRefs(topics, refs).map((ref) => fallbackTopic(withText, ref));
    this.logger.log(
      `Summary: ${topics.length + fallback.length} topics from ${withText.length} posts, ` +
        `coverage retries=${retries}, fallback=${fallback.length}`,
    );
    return { topics: [...topics, ...fallback], fallbackTopicCount: fallback.length };
  }

  private async requestSummary(posts: TranslatedPost[]): Promise<DigestTopic[]> {
    const answer = await this.grok.completeJson({
      system: SUMMARY_SYSTEM_PROMPT,
      user: posts.map(summaryInputOf).join('\n\n'),
      schemaName: 'digest',
      schema: SUMMARY_SCHEMA,
      isValid: isSummaryAnswer,
    });
    return answer.topics.map(toTopic);
  }

  /** Asks where the missing posts belong; a failed follow-up leaves the topics as they are. */
  private async placeMissing(
    topics: DigestTopic[],
    posts: TranslatedPost[],
    missing: string[],
  ): Promise<DigestTopic[]> {
    const missingSet = new Set(missing);
    try {
      const answer = await this.grok.completeJson({
        system: SUMMARY_COVERAGE_SYSTEM_PROMPT,
        user: coverageInputOf(
          topics,
          posts.filter((post) => missingSet.has(post.ref)),
        ),
        schemaName: 'digest_completion',
        schema: COVERAGE_SCHEMA,
        isValid: isCoverageAnswer,
      });
      return applyCoverage(topics, answer);
    } catch {
      return topics;
    }
  }
}

function summaryInputOf(post: TranslatedPost): string {
  return `[${post.ref}] @${post.channel}: ${truncateText(post.translated, SUMMARY_POST_MAX_CHARS)}`;
}

function coverageInputOf(topics: DigestTopic[], missing: TranslatedPost[]): string {
  const numbered = topics.map((topic, index) => `${index + 1}. ${topic.thesis}`);
  return ['Topics:', ...numbered, '', 'Left-out posts:', ...missing.map(summaryInputOf)].join('\n');
}

/** Adds references to the numbered topics (1-based) and appends new topics; bad numbers are ignored. */
function applyCoverage(topics: DigestTopic[], answer: CoverageAnswer): DigestTopic[] {
  const updated = topics.map((topic) => ({ ...topic, refs: [...topic.refs] }));
  for (const { topicNumber, refs } of answer.additions) {
    updated[topicNumber - 1]?.refs.push(...refs);
  }
  return [...updated, ...answer.newTopics.map(toTopic)];
}

function toTopic(answer: TopicAnswer): DigestTopic {
  return {
    thesis: answer.thesis.trim(),
    viewpoints: answer.viewpoints,
    refs: answer.refs,
    isFallback: false,
  };
}

function fallbackTopic(posts: TranslatedPost[], ref: string): DigestTopic {
  const post = posts.find((candidate) => candidate.ref === ref);
  return {
    thesis: truncateText(post?.translated ?? '', DIGEST_FALLBACK_THESIS_CHARS),
    viewpoints: [],
    refs: [ref],
    isFallback: true,
  };
}
