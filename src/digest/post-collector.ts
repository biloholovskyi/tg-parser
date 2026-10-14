import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AlertService } from '../alerts/alert.service';
import { MS_IN_SECOND } from '../shared/constants/rate-limit.constants';
import { TooManyRequestsException } from '../shared/exceptions/too-many-requests.exception';
import type { TelegramPost } from '../telegram/interfaces/message.interface';
import { TelegramService } from '../telegram/telegram.service';
import {
  DIGEST_FLOOD_WAIT_MARGIN_S,
  DIGEST_FLOOD_WAIT_MAX_S,
  DIGEST_FLOOD_WAIT_TOTAL_MAX_S,
  DIGEST_POST_MAX_CHARS,
  POST_REF_PREFIX,
} from './constants';
import type { CollectedPosts, DigestPost } from './interfaces/digest-post.interface';
import { delayUnlessCancelled, throwIfCancelled } from './utils/cancellable-delay';
import { truncateText } from './utils/text';

/** Failures that concern the account or the transport, not one channel: the run stops. */
const RUN_FATAL_STATUSES: readonly number[] = [
  HttpStatus.UNAUTHORIZED,
  HttpStatus.TOO_MANY_REQUESTS,
  HttpStatus.SERVICE_UNAVAILABLE,
];

/** State of one collection: what was gathered and how long it has waited on flood limits. */
interface Collection {
  result: CollectedPosts;
  hoursBack: number;
  signal: AbortSignal;
  floodWaitedS: number;
}

/**
 * Reads the digest channels one at a time with the marked digest session.
 * A channel that cannot be read is reported and skipped; an account-level failure ends the run.
 * A flood wait within DIGEST_FLOOD_WAIT_MAX_S, and within DIGEST_FLOOD_WAIT_TOTAL_MAX_S for the
 * run, is sat out and the same channel is read again; the wait ends early when `signal` aborts.
 */
@Injectable()
export class PostCollector {
  private readonly logger = new Logger(PostCollector.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly alerts: AlertService,
  ) {}

  async collect(
    channels: readonly string[],
    hoursBack: number,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<CollectedPosts> {
    const result: CollectedPosts = {
      posts: [],
      channelCount: channels.length,
      unavailableChannels: [],
      truncatedChannels: [],
    };
    const collection: Collection = { result, hoursBack, signal, floodWaitedS: 0 };
    for (const channel of channels) {
      await this.collectChannel(channel, collection);
    }
    this.logger.log(
      `Collected ${result.posts.length} posts from ${channels.length} channels, ` +
        `unavailable=${result.unavailableChannels.length}, truncated=${result.truncatedChannels.length}`,
    );
    return result;
  }

  private async collectChannel(channel: string, collection: Collection): Promise<void> {
    for (;;) {
      throwIfCancelled(collection.signal);
      try {
        await this.readChannel(channel, collection);
        return;
      } catch (error: unknown) {
        const waitS = floodWaitWithinLimits(error, collection.floodWaitedS);
        if (waitS === undefined) {
          skipOrRethrow(error, channel, collection.result);
          return;
        }
        await this.waitForFloodLimit(channel, waitS, collection);
      }
    }
  }

  private async readChannel(channel: string, collection: Collection): Promise<void> {
    const { result } = collection;
    const { posts, isTruncated } = await this.telegram.readPostsAsDigestAccount(
      channel,
      collection.hoursBack,
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
  }

  private async waitForFloodLimit(
    channel: string,
    waitS: number,
    collection: Collection,
  ): Promise<void> {
    this.logger.warn(`Digest: Telegram flood limit on @${channel}, waiting ${waitS} s`);
    this.alerts.warning('Digest waiting for Telegram flood limit', { channel, seconds: waitS });
    collection.floodWaitedS += waitS;
    await delayUnlessCancelled(
      (waitS + DIGEST_FLOOD_WAIT_MARGIN_S) * MS_IN_SECOND,
      collection.signal,
    );
  }
}

/** The wait to sit out, or undefined when the error is not a flood wait or the wait is too long. */
function floodWaitWithinLimits(error: unknown, waitedS: number): number | undefined {
  if (!(error instanceof TooManyRequestsException)) {
    return undefined;
  }
  const waitS = error.retryAfterSeconds;
  const isWithinLimits =
    waitS <= DIGEST_FLOOD_WAIT_MAX_S && waitedS + waitS <= DIGEST_FLOOD_WAIT_TOTAL_MAX_S;
  return isWithinLimits ? waitS : undefined;
}

/** An account-level failure ends the run; any other channel failure skips the channel. */
function skipOrRethrow(error: unknown, channel: string, result: CollectedPosts): void {
  if (!(error instanceof HttpException) || RUN_FATAL_STATUSES.includes(error.getStatus())) {
    throw error;
  }
  result.unavailableChannels.push(channel);
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
