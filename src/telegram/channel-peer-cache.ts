import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { hashSecret } from '../shared/utils/secret-cipher';
import {
  CHANNEL_PEER_CACHE_MAX_ENTRIES,
  CHANNEL_PEER_KEY_PREFIX,
  CHANNEL_PEER_TTL_S,
} from './constants';

/** What a channel read needs instead of a username lookup; decimal strings of MTProto longs. */
export interface ChannelPeer {
  channelId: string;
  accessHash: string;
}

/**
 * Remembers the resolved peer of a channel per account, so a channel is looked up by username
 * (a request with a tight daily limit) once per CHANNEL_PEER_TTL_S instead of on every read.
 * Redis when it is configured, otherwise a bounded in-memory map. A failing Redis behaves as an
 * empty cache: a read never fails because of it.
 */
@Injectable()
export class ChannelPeerCache {
  private readonly logger = new Logger(ChannelPeerCache.name);
  private readonly memory = new Map<string, ChannelPeer>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  /** The cached peer, or undefined on a miss or when Redis fails; a hit extends its lifetime. */
  async get(sessionString: string, username: string): Promise<ChannelPeer | undefined> {
    const key = peerKey(sessionString, username);
    const { redis } = this;
    if (!redis) {
      return this.touchMemory(key);
    }
    const stored = await this.call('read', () => redis.get(key));
    const peer = typeof stored === 'string' ? parsePeer(stored) : undefined;
    if (peer) {
      await this.call('extend', () => redis.expire(key, CHANNEL_PEER_TTL_S));
    }
    return peer;
  }

  async set(sessionString: string, username: string, peer: ChannelPeer): Promise<void> {
    const key = peerKey(sessionString, username);
    const { redis } = this;
    if (!redis) {
      this.memory.delete(key);
      this.memory.set(key, peer);
      this.evictOverflow();
      return;
    }
    await this.call('write', () => redis.set(key, JSON.stringify(peer), 'EX', CHANNEL_PEER_TTL_S));
  }

  async remove(sessionString: string, username: string): Promise<void> {
    const key = peerKey(sessionString, username);
    const { redis } = this;
    if (!redis) {
      this.memory.delete(key);
      return;
    }
    await this.call('remove', () => redis.del(key));
  }

  /** Re-inserts a hit so the map keeps least recently used entries first. */
  private touchMemory(key: string): ChannelPeer | undefined {
    const peer = this.memory.get(key);
    if (peer) {
      this.memory.delete(key);
      this.memory.set(key, peer);
    }
    return peer;
  }

  private evictOverflow(): void {
    while (this.memory.size > CHANNEL_PEER_CACHE_MAX_ENTRIES) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.memory.delete(oldest);
    }
  }

  /** One warning per failed command, naming only the error class. */
  private async call<T>(action: string, command: () => Promise<T>): Promise<T | undefined> {
    try {
      return await command();
    } catch (error: unknown) {
      this.logger.warn(
        `Channel peer cache ${action} failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return undefined;
    }
  }
}

/** The session appears only as its SHA-256; usernames are case-insensitive in Telegram. */
function peerKey(sessionString: string, username: string): string {
  return `${CHANNEL_PEER_KEY_PREFIX}${hashSecret(sessionString)}:${username.toLowerCase()}`;
}

const DECIMAL_PATTERN = /^-?\d+$/;

/** A stored value that is not a valid peer is treated as a miss. */
function parsePeer(stored: string): ChannelPeer | undefined {
  try {
    const value = JSON.parse(stored) as Partial<ChannelPeer> | null;
    const { channelId, accessHash } = value ?? {};
    if (
      typeof channelId === 'string' &&
      typeof accessHash === 'string' &&
      DECIMAL_PATTERN.test(channelId) &&
      DECIMAL_PATTERN.test(accessHash)
    ) {
      return { channelId, accessHash };
    }
  } catch {
    // Not JSON: a miss, overwritten by the next lookup.
  }
  return undefined;
}
