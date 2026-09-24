import { Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Logger as GramLogger, LogLevel } from 'telegram/extensions/Logger';
import { getTelegramConfig } from '../config/telegram.config';
import type { TelegramConfig } from '../config/telegram.config';
import {
  CONNECTION_RETRIES_COUNT,
  FLOOD_SLEEP_THRESHOLD_S,
  REQUEST_RETRIES_COUNT,
  RETRY_DELAY_MS,
} from './constants';
import { describeError } from './utils/telegram-errors';

const EMPTY_CREDENTIALS: TelegramConfig = { apiId: 0, apiHash: '' };

/**
 * The single place a GramJS client is constructed, always with explicit options.
 * Creating is all it does: connecting and releasing belong to SessionStore.
 */
@Injectable()
export class TelegramClientFactory {
  private readonly logger = new Logger(TelegramClientFactory.name);
  readonly credentials: TelegramConfig;

  constructor() {
    // Boot must not fail without credentials: the health probe stays up and the first real use fails.
    this.credentials = this.loadCredentials();
  }

  get hasCredentials(): boolean {
    return Boolean(this.credentials.apiId && this.credentials.apiHash);
  }

  /** Builds a disconnected client for the session, or for a new login when none is given. */
  create(sessionString = ''): TelegramClient {
    const { apiId, apiHash } = this.credentials;
    return new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
      floodSleepThreshold: FLOOD_SLEEP_THRESHOLD_S,
      connectionRetries: CONNECTION_RETRIES_COUNT,
      requestRetries: REQUEST_RETRIES_COUNT,
      retryDelay: RETRY_DELAY_MS,
      autoReconnect: true,
      // GramJS prints to the console on its own; keep it to errors so it cannot flood the billed log.
      baseLogger: new GramLogger(LogLevel.ERROR),
    });
  }

  private loadCredentials(): TelegramConfig {
    try {
      return getTelegramConfig();
    } catch (error: unknown) {
      this.logger.warn(`Config not loaded, will fail on first use: ${describeError(error)}`);
      return EMPTY_CREDENTIALS;
    }
  }
}
