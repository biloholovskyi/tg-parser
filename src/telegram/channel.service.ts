import { Injectable, Logger } from '@nestjs/common';
import type { TelegramClient } from 'telegram';
import { Api } from 'telegram/tl';
import { MS_IN_SECOND } from '../shared/constants/rate-limit.constants';
import {
  EXTERNAL_CALL_TIMEOUT_MS,
  POSTS_MAX_MESSAGES,
  POSTS_PAGE_SIZE,
  SECONDS_IN_HOUR,
} from './constants';
import type { GetPostsResponse } from './interfaces/message.interface';
import { SessionStore } from './session-store';
import { toTelegramPost } from './utils/message.mapper';
import { failWith } from './utils/telegram-errors';
import { withTimeout } from './utils/with-timeout';

interface PageRequest {
  limit: number;
  offsetId: number;
}

interface ChannelWalk {
  client: TelegramClient;
  channel: Api.TypeInputPeer;
  windowStart: number;
}

/** Reads channel history newest-first inside a time window, capped at POSTS_MAX_MESSAGES. */
@Injectable()
export class ChannelService {
  private readonly logger = new Logger(ChannelService.name);

  constructor(private readonly sessions: SessionStore) {}

  /**
   * Returns posts of a channel inside the last `hoursBack` hours.
   * `isTruncated` tells the caller that older posts inside the window were not returned.
   */
  async getChannelPosts(
    channelUsername: string,
    sessionString: string,
    hoursBack: number,
  ): Promise<GetPostsResponse> {
    try {
      const client = await this.sessions.getConnected(sessionString);
      const windowStart = Math.floor(Date.now() / MS_IN_SECOND) - hoursBack * SECONDS_IN_HOUR;
      const walk = await this.openWalk(client, channelUsername, windowStart);
      const { messages, isTruncated } = await this.walkChannel(walk);
      const posts = messages.map((message) => toTelegramPost(message, channelUsername));
      this.logger.log(
        `Posts: @${channelUsername} ${hoursBack}h -> ${posts.length} posts, truncated=${isTruncated}`,
      );
      return { posts, count: posts.length, isTruncated };
    } catch (error: unknown) {
      await this.sessions.evictIfSessionInvalid(sessionString, error);
      throw failWith(this.logger, `Posts: @${channelUsername}`, error);
    }
  }

  private async openWalk(
    client: TelegramClient,
    channelUsername: string,
    windowStart: number,
  ): Promise<ChannelWalk> {
    const channel = await withTimeout(
      client.getInputEntity(channelUsername),
      EXTERNAL_CALL_TIMEOUT_MS,
      'Resolve channel',
    );
    return { client, channel, windowStart };
  }

  /**
   * Walks page by page until a message leaves the window, the history ends,
   * or POSTS_MAX_MESSAGES is reached.
   */
  private async walkChannel(
    walk: ChannelWalk,
  ): Promise<{ messages: Api.Message[]; isTruncated: boolean }> {
    const { windowStart } = walk;
    const messages: Api.Message[] = [];
    let walked = 0;
    let offsetId = 0;

    while (walked < POSTS_MAX_MESSAGES) {
      const limit = Math.min(POSTS_PAGE_SIZE, POSTS_MAX_MESSAGES - walked);
      const page = await this.fetchPage(walk, { limit, offsetId });
      walked += page.length;
      messages.push(...page.filter((item) => isPostInWindow(item, windowStart)));
      if (page.length < limit || page.some((item) => isOlderThan(item, windowStart))) {
        return { messages, isTruncated: false };
      }
      offsetId = page[page.length - 1].id;
    }

    return { messages, isTruncated: await this.hasOlderInWindow(walk, offsetId) };
  }

  /** Probes one message past the ceiling so a window that ends exactly there is not flagged. */
  private async hasOlderInWindow(walk: ChannelWalk, offsetId: number): Promise<boolean> {
    const [next] = await this.fetchPage(walk, { limit: 1, offsetId });
    return next !== undefined && !isOlderThan(next, walk.windowStart);
  }

  private async fetchPage(walk: ChannelWalk, page: PageRequest): Promise<Api.TypeMessage[]> {
    const result = await withTimeout(
      walk.client.getMessages(walk.channel, page),
      EXTERNAL_CALL_TIMEOUT_MS,
      'Get messages',
    );
    return [...result];
  }
}

/** A regular post (not a service message) dated inside the window. */
function isPostInWindow(item: Api.TypeMessage, windowStart: number): item is Api.Message {
  return item instanceof Api.Message && item.date >= windowStart;
}

/** True when the item is dated before the window; undated items never end the walk. */
function isOlderThan(item: Api.TypeMessage, windowStart: number): boolean {
  return 'date' in item && typeof item.date === 'number' && item.date < windowStart;
}
