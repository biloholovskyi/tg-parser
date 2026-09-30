import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { DigestConfig } from '../config/digest.config';
import { MS_IN_SECOND } from '../shared/constants/rate-limit.constants';
import {
  BOT_API_BASE_URL,
  BOT_CALL_TIMEOUT_MS,
  BOT_MAX_RETRIES,
  BOT_MAX_RETRY_AFTER_S,
  BOT_RETRY_BASE_DELAY_MS,
  DIGEST_CONFIG,
} from './constants';

const MAX_DESCRIPTION_CHARS = 200;

/** A failed Bot API call; the message carries the status and Telegram's description, never the URL. */
export class BotError extends Error {
  constructor(
    message: string,
    readonly isRetryable: boolean,
    readonly retryAfterS?: number,
  ) {
    super(message);
    this.name = 'BotError';
  }
}

interface BotApiAnswer {
  ok?: boolean;
  description?: string;
  parameters?: { retry_after?: number };
}

/**
 * Sends messages to the configured chat through the Telegram Bot API, one at a time and in
 * order. The bot token sits in the request URL, so neither the URL nor the token is ever logged.
 */
@Injectable()
export class BotNotifier {
  constructor(@Inject(DIGEST_CONFIG) private readonly config: DigestConfig) {}

  /** Sends every message in order; the first message that cannot be delivered throws. */
  async send(messages: readonly string[]): Promise<void> {
    for (const message of messages) {
      await this.sendWithRetries(message);
    }
  }

  private async sendWithRetries(text: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.sendOnce(text);
      } catch (error: unknown) {
        const botError = toBotError(error);
        if (!botError.isRetryable || attempt >= BOT_MAX_RETRIES) {
          throw botError;
        }
        await sleep(retryDelayMs(botError, attempt));
      }
    }
  }

  private async sendOnce(text: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BOT_CALL_TIMEOUT_MS);
    try {
      const response = await fetch(`${BOT_API_BASE_URL}/bot${this.config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.botChatId,
          text,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        }),
        signal: controller.signal,
      });
      await checkAnswer(response);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function checkAnswer(response: Response): Promise<void> {
  const answer = (await response.json().catch(() => ({}))) as BotApiAnswer;
  if (response.ok && answer.ok !== false) {
    return;
  }
  const description = (answer.description ?? '').slice(0, MAX_DESCRIPTION_CHARS);
  const message = `HTTP ${response.status}${description ? ` (${description})` : ''}`;
  if (response.status === HttpStatus.TOO_MANY_REQUESTS) {
    const retryAfterS = answer.parameters?.retry_after ?? 1;
    throw new BotError(message, retryAfterS <= BOT_MAX_RETRY_AFTER_S, retryAfterS);
  }
  throw new BotError(message, response.status >= HttpStatus.INTERNAL_SERVER_ERROR);
}

/** Honors Telegram's `retry_after`; other transient failures back off linearly. */
function retryDelayMs(error: BotError, attempt: number): number {
  return error.retryAfterS !== undefined
    ? error.retryAfterS * MS_IN_SECOND
    : (attempt + 1) * BOT_RETRY_BASE_DELAY_MS;
}

/** Aborts and network failures are retryable; their message never includes the URL. */
function toBotError(error: unknown): BotError {
  if (error instanceof BotError) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new BotError('timeout', true);
  }
  return new BotError(`network error (${error instanceof Error ? error.name : 'unknown'})`, true);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
