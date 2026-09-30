import { Injectable, Logger } from '@nestjs/common';
import type { TelegramClient } from 'telegram';
import type { StringSession } from 'telegram/sessions';
import {
  CONNECTION_LABEL,
  EXTERNAL_CALL_TIMEOUT_MS,
  SESSION_CACHE_IDLE_TTL_MS,
  SESSION_CACHE_MAX_ENTRIES,
  SESSION_CACHE_SWEEP_INTERVAL_MS,
} from './constants';
import { SessionRepository } from './session-repository';
import { TelegramClientFactory } from './telegram-client.factory';
import { SessionClientCache } from './utils/session-client-cache';
import {
  describeError,
  invalidSessionException,
  isInvalidSessionError,
} from './utils/telegram-errors';
import { withTimeout } from './utils/with-timeout';

/**
 * Sole owner of the Telegram client lifecycle: every client is connected and released here.
 * Live clients are cached in memory; issued sessions are also recorded in SessionRepository, so
 * a session with no cached client is reconnected from its string when the record exists.
 */
@Injectable()
export class SessionStore {
  private readonly logger = new Logger(SessionStore.name);
  /** One restore per session at a time, so concurrent misses share a single client. */
  private readonly restoring = new Map<string, Promise<TelegramClient>>();
  private readonly clients = new SessionClientCache<TelegramClient>({
    maxEntries: SESSION_CACHE_MAX_ENTRIES,
    idleTtlMs: SESSION_CACHE_IDLE_TTL_MS,
    sweepIntervalMs: SESSION_CACHE_SWEEP_INTERVAL_MS,
  });

  constructor(
    private readonly factory: TelegramClientFactory,
    private readonly repository: SessionRepository,
  ) {
    this.clients.startSweeping();
  }

  /** Creates and connects a client for a new login, releasing it if the connection fails. */
  async openLoginClient(): Promise<TelegramClient> {
    const client = this.factory.create();
    try {
      await withTimeout(client.connect(), EXTERNAL_CALL_TIMEOUT_MS, CONNECTION_LABEL);
    } catch (error: unknown) {
      await this.release(client);
      throw error;
    }
    return client;
  }

  /**
   * Caches a freshly authorized client under its session string, records the session and
   * returns the string. A failed record keeps the login usable until the next restart.
   */
  async adopt(client: TelegramClient): Promise<string> {
    const sessionString = (client.session as StringSession).save();
    await this.clients.set(sessionString, client);
    try {
      await this.repository.save(sessionString);
    } catch (error: unknown) {
      this.logger.warn(`Session not persisted: ${describeError(error)}`);
    }
    return sessionString;
  }

  /**
   * Returns the connected client for the session: from the cache, or reconnected from the
   * stored record after a restart or an idle eviction. Unknown sessions are a 401.
   */
  async getConnected(sessionString: string): Promise<TelegramClient> {
    const key = sessionString.trim();
    const cached = this.clients.get(key);
    if (cached) {
      this.touchRecord(key);
    }
    const client = cached ?? (await this.restoreOnce(key));
    if (!client.connected) {
      await withTimeout(client.connect(), EXTERNAL_CALL_TIMEOUT_MS, CONNECTION_LABEL);
    }
    return client;
  }

  /** Drops the client and the stored record once Telegram has rejected the session for good. */
  async evictIfSessionInvalid(sessionString: string, error: unknown): Promise<void> {
    if (isInvalidSessionError(error)) {
      await this.evict(sessionString);
      await this.repository.remove(sessionString.trim());
    }
  }

  /** Removes the session from the cache and releases its client; unknown sessions are a no-op. */
  async evict(sessionString: string): Promise<void> {
    await this.clients.evict(sessionString.trim());
  }

  private restoreOnce(sessionString: string): Promise<TelegramClient> {
    const pending = this.restoring.get(sessionString);
    if (pending) {
      return pending;
    }
    const restore = this.restore(sessionString).finally(() => this.restoring.delete(sessionString));
    this.restoring.set(sessionString, restore);
    return restore;
  }

  /** Rebuilds the client of a stored session and caches it; the record must exist. */
  private async restore(sessionString: string): Promise<TelegramClient> {
    if (!(await this.repository.isKnown(sessionString))) {
      throw invalidSessionException();
    }
    const client = this.factory.create(sessionString);
    try {
      await withTimeout(client.connect(), EXTERNAL_CALL_TIMEOUT_MS, CONNECTION_LABEL);
    } catch (error: unknown) {
      await this.release(client);
      throw error;
    }
    await this.clients.set(sessionString, client);
    return client;
  }

  /** Extends the stored record in the background; a cache hit never waits on Redis. */
  private touchRecord(sessionString: string): void {
    this.repository.touch(sessionString).catch(() => {
      // The Redis client logs the outage once; the cached client keeps serving meanwhile.
    });
  }

  /** Tears a client down for good; `destroy` also stops the GramJS update loop that would reconnect. */
  async release(client: TelegramClient): Promise<void> {
    try {
      await client.destroy();
    } catch {
      // The client is being dropped either way; a failed teardown leaves nothing to retry.
    }
  }

  /** Stops the idle sweep and releases every cached client. */
  async close(): Promise<void> {
    await this.clients.close();
  }
}
