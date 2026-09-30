import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { TelegramPost } from '../telegram/interfaces/message.interface';
import { TelegramService } from '../telegram/telegram.service';
import { DIGEST_POST_MAX_CHARS, POST_REF_PREFIX } from './constants';
import type { CollectedPosts, DigestPost } from './interfaces/digest-post.interface';
import { truncateText } from './utils/text';

/** Failures that concern the account or the transport, not one channel: the run stops. */
const RUN_FATAL_STATUSES: readonly number[] = [
  HttpStatus.UNAUTHORIZED,
  HttpStatus.TOO_MANY_REQUESTS,
  HttpStatus.SERVICE_UNAVAILABLE,
];

/**
 * Reads the digest channels one at a time with the marked digest session.
 * A channel that cannot be read is reported and skipped; an account-level failure ends the run.
 */
@Injectable()
export class PostCollector {
  private readonly logger = new Logger(PostCollector.name);

  constructor(private readonly telegram: TelegramService) {}

  async collect(channels: readonly string[], hoursBack: number): Promise<CollectedPosts> {
    const result: CollectedPosts = {
      posts: [],
      channelCount: channels.length,
      unavailableChannels: [],
      truncatedChannels: [],
    };
    for (const channel of channels) {
      await this.collectChannel(channel, hoursBack, result);
    }
    this.logger.log(
      `Collected ${result.posts.length} posts from ${channels.length} channels, ` +
        `unavailable=${result.unavailableChannels.length}, truncated=${result.truncatedChannels.length}`,
    );
    return result;
  }

  private async collectChannel(
    channel: string,
    hoursBack: number,
    result: CollectedPosts,
  ): Promise<void> {
    try {
      const { posts, isTruncated } = await this.telegram.readPostsAsDigestAccount(
        channel,
        hoursBack,
      );
      const oldestFirst = [...posts].sort(
        (left, right) => left.date.getTime() - right.date.getTime(),
      );
      for (const post of oldestFirst) {
        result.posts.push(toDigestPost(post, channel, result.posts.length + 1));
      }
      if (isTruncated) {
        result.truncatedChannels.push(channel);
      }
    } catch (error: unknown) {
      if (!(error instanceof HttpException) || RUN_FATAL_STATUSES.includes(error.getStatus())) {
        throw error;
      }
      result.unavailableChannels.push(channel);
    }
  }
}

/** The text is cut to DIGEST_POST_MAX_CHARS here, so a run never holds full long posts. */
function toDigestPost(post: TelegramPost, channel: string, ordinal: number): DigestPost {
  const text = truncateText(post.text.trim(), DIGEST_POST_MAX_CHARS);
  return {
    ref: `${POST_REF_PREFIX}${ordinal}`,
    channel,
    url: post.postUrl,
    text,
    date: post.date,
    hasText: text.length > 0,
  };
}
