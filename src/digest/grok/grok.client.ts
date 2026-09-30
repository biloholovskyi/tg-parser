import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { DigestConfig } from '../../config/digest.config';
import {
  DIGEST_CONFIG,
  GROK_CALL_TIMEOUT_MS,
  GROK_CHAT_COMPLETIONS_URL,
  GROK_MAX_RETRIES,
  GROK_RETRY_BASE_DELAY_MS,
} from '../constants';

/** One structured request: the model must answer with JSON matching `schema`. */
export interface GrokJsonRequest<T> {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  /** Runtime check of the parsed answer; the schema alone is not trusted. */
  isValid: (value: unknown) => value is T;
}

/** A failed Grok call; the message carries a status or a reason, never the key or the prompt. */
export class GrokError extends Error {
  constructor(
    message: string,
    readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = 'GrokError';
  }
}

/**
 * Calls xAI chat completions with a JSON schema answer, a per-call timeout that is always
 * cleared, and bounded retries for rate limits, server errors, timeouts and unusable answers.
 */
@Injectable()
export class GrokClient {
  private readonly logger = new Logger(GrokClient.name);

  constructor(@Inject(DIGEST_CONFIG) private readonly config: DigestConfig) {}

  async completeJson<T>(request: GrokJsonRequest<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.callOnce(request);
      } catch (error: unknown) {
        const grokError = toGrokError(error);
        if (!grokError.isRetryable || attempt >= GROK_MAX_RETRIES) {
          this.logger.error(`Grok ${request.schemaName} failed: ${grokError.message}`);
          throw grokError;
        }
        await sleep((attempt + 1) * GROK_RETRY_BASE_DELAY_MS);
      }
    }
  }

  private async callOnce<T>(request: GrokJsonRequest<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROK_CALL_TIMEOUT_MS);
    try {
      const response = await fetch(GROK_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.grokApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.buildBody(request)),
        signal: controller.signal,
      });
      // Awaited inside the try: the body is still streaming until parsed, and the timer guards it.
      return await parseAnswer(response, request);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildBody<T>(request: GrokJsonRequest<T>): Record<string, unknown> {
    return {
      model: this.config.grokModel,
      stream: false,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.schemaName, schema: request.schema, strict: true },
      },
    };
  }
}

async function parseAnswer<T>(response: Response, request: GrokJsonRequest<T>): Promise<T> {
  if (!response.ok) {
    throw new GrokError(`HTTP ${response.status}`, isRetryableStatus(response.status));
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new GrokError('answer has no content', true);
  }
  const parsed = parseJson(content);
  if (!request.isValid(parsed)) {
    throw new GrokError('answer does not match the schema', true);
  }
  return parsed;
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new GrokError('answer is not valid JSON', true);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === HttpStatus.TOO_MANY_REQUESTS || status >= HttpStatus.INTERNAL_SERVER_ERROR;
}

/** Aborts and network failures are retryable; their text never includes the request. */
function toGrokError(error: unknown): GrokError {
  if (error instanceof GrokError) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new GrokError('timeout', true);
  }
  return new GrokError(`network error (${error instanceof Error ? error.name : 'unknown'})`, true);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
