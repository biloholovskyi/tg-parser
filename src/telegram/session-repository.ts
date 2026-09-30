import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { SessionPersistenceConfig } from '../config/redis.config';
import { REDIS_CLIENT, SESSION_PERSISTENCE_CONFIG } from '../redis/redis.constants';
import { decryptSecret, encryptSecret, hashSecret } from '../shared/utils/secret-cipher';
import { DIGEST_SESSION_KEY, SESSION_STORE_KEY_PREFIX, SESSION_STORE_TTL_S } from './constants';
import { sessionStorageUnavailableException } from './utils/telegram-errors';

/**
 * Durable record of issued sessions: Redis keyed by the SHA-256 of the session string, the value
 * encrypted with AES-256-GCM. Without persistence config every lookup misses and writes are
 * no-ops, except the digest mark, which is then held in memory for the life of the process.
 */
@Injectable()
export class SessionRepository {
  private memoryDigestSession: string | undefined;
  /** Redis is used only together with its encryption key; one without the other means memory. */
  private readonly redis: Redis | null;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis | null,
    @Inject(SESSION_PERSISTENCE_CONFIG) private readonly config: SessionPersistenceConfig | null,
  ) {
    this.redis = config ? redis : null;
  }

  /** Stores the session for SESSION_STORE_TTL_S. */
  async save(sessionString: string): Promise<void> {
    const { redis, config } = this;
    if (!redis || !config) {
      return;
    }
    const payload = encryptSecret(sessionString, config.encryptionKey);
    await this.call(() => redis.set(recordKey(sessionString), payload, 'EX', SESSION_STORE_TTL_S));
  }

  /**
   * True when this exact session was issued and is still stored; extends its lifetime.
   * A record that no longer decrypts (the key changed) is deleted and reported as unknown.
   */
  async isKnown(sessionString: string): Promise<boolean> {
    const stored = await this.read(hashSecret(sessionString));
    if (stored !== sessionString) {
      return false;
    }
    await this.touch(sessionString);
    return true;
  }

  /** Extends the lifetime of a stored session; unknown sessions are a no-op. */
  async touch(sessionString: string): Promise<void> {
    const { redis } = this;
    if (redis) {
      await this.call(() => redis.expire(recordKey(sessionString), SESSION_STORE_TTL_S));
    }
  }

  /** Forgets the session, and the digest mark when it points at this session. */
  async remove(sessionString: string): Promise<void> {
    if (this.memoryDigestSession === sessionString) {
      this.memoryDigestSession = undefined;
    }
    const { redis } = this;
    if (!redis) {
      return;
    }
    const hash = hashSecret(sessionString);
    await this.call(async () => {
      if ((await redis.get(DIGEST_SESSION_KEY)) === hash) {
        await redis.del(DIGEST_SESSION_KEY);
      }
      await redis.del(SESSION_STORE_KEY_PREFIX + hash);
    });
  }

  /** Marks the session the daily digest reads channels with. */
  async markDigest(sessionString: string): Promise<void> {
    const { redis } = this;
    if (!redis) {
      this.memoryDigestSession = sessionString;
      return;
    }
    await this.call(() => redis.set(DIGEST_SESSION_KEY, hashSecret(sessionString)));
  }

  /** The session marked for the digest, or undefined when none is marked or it is gone. */
  async loadDigest(): Promise<string | undefined> {
    const { redis } = this;
    if (!redis) {
      return this.memoryDigestSession;
    }
    const hash = await this.call(() => redis.get(DIGEST_SESSION_KEY));
    return hash ? this.read(hash) : undefined;
  }

  private async read(hash: string): Promise<string | undefined> {
    const { redis, config } = this;
    if (!redis || !config) {
      return undefined;
    }
    const key = SESSION_STORE_KEY_PREFIX + hash;
    const payload = await this.call(() => redis.get(key));
    if (!payload) {
      return undefined;
    }
    try {
      return decryptSecret(payload, config.encryptionKey);
    } catch {
      await this.call(() => redis.del(key));
      return undefined;
    }
  }

  /** Every Redis failure surfaces as the same 503; the Redis error stays in `cause` only. */
  private async call<T>(command: () => Promise<T>): Promise<T> {
    try {
      return await command();
    } catch (error: unknown) {
      throw sessionStorageUnavailableException(error);
    }
  }
}

function recordKey(sessionString: string): string {
  return SESSION_STORE_KEY_PREFIX + hashSecret(sessionString);
}
