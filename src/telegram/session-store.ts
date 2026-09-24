import { Injectable } from '@nestjs/common';
import type { TelegramClient } from 'telegram';
import type { StringSession } from 'telegram/sessions';
import {
  CONNECTION_LABEL,
  EXTERNAL_CALL_TIMEOUT_MS,
  SESSION_CACHE_IDLE_TTL_MS,
  SESSION_CACHE_MAX_ENTRIES,
  SESSION_CACHE_SWEEP_INTERVAL_MS,
} from './constants';
import { TelegramClientFactory } from './telegram-client.factory';
import { SessionClientCache } from './utils/session-client-cache';
import { invalidSessionException, isInvalidSessionError } from './utils/telegram-errors';
import { withTimeout } from './utils/with-timeout';

/**
 * Sole owner of the Telegram client lifecycle: every client is connected and released here.
 * Sessions live in process memory only, so a session string with no cached client is unknown.
 */
@Injectable()
export class SessionStore {
  private readonly clients = new SessionClientCache<TelegramClient>({
    maxEntries: SESSION_CACHE_MAX_ENTRIES,
    idleTtlMs: SESSION_CACHE_IDLE_TTL_MS,
    sweepIntervalMs: SESSION_CACHE_SWEEP_INTERVAL_MS,
  });

  constructor(private readonly factory: TelegramClientFactory) {
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

  /** Caches a freshly authorized client under its session string and returns that string. */
  async adopt(client: TelegramClient): Promise<string> {
    const sessionString = (client.session as StringSession).save();
    await this.clients.set(sessionString, client);
    return sessionString;
  }

  /** Returns the cached client for the session, reconnecting it when the socket dropped. */
  async getConnected(sessionString: string): Promise<TelegramClient> {
    const client = this.clients.get(sessionString.trim());
    if (!client) {
      throw invalidSessionException();
    }
    if (!client.connected) {
      await withTimeout(client.connect(), EXTERNAL_CALL_TIMEOUT_MS, CONNECTION_LABEL);
    }
    return client;
  }

  /** Drops and releases the cached client once Telegram has rejected its session for good. */
  async evictIfSessionInvalid(sessionString: string, error: unknown): Promise<void> {
    if (isInvalidSessionError(error)) {
      await this.evict(sessionString);
    }
  }

  /** Removes the session from the cache and releases its client; unknown sessions are a no-op. */
  async evict(sessionString: string): Promise<void> {
    await this.clients.evict(sessionString.trim());
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
