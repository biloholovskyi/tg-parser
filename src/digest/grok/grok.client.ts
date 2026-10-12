import { HttpStatus, Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Agent, fetch } from 'undici';
import type { Response } from 'undici';
import type { DigestConfig } from '../../config/digest.config';
import {
  DIGEST_CONFIG,
  GROK_CALL_TIMEOUT_MS,
  GROK_CHAT_COMPLETIONS_URL,
  GROK_MAX_RETRIES,
  GROK_RETRY_BASE_DELAY_MS,
  GROK_SUMMARY_TIMEOUT_MS,
} from '../constants';

/** One structured request: the model must answer with JSON matching `schema`. */
export interface GrokJsonRequest<T> {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  /** Runtime check of the parsed answer; the schema alone is not trusted. */
  isValid: (value: unknown) => value is T;
  /** Per-attempt limit, GROK_CALL_TIMEOUT_MS by default. */
  timeoutMs?: number;
  /** Retries after a fast failure, GROK_MAX_RETRIES by default. */
  maxRetries?: number;
  /** False for a long request: a timed-out attempt is not sent again. True by default. */
  isTimeoutRetryable?: boolean;
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
 * Requests go through an own undici agent: the default dispatcher behind the global `fetch`
 * drops a response whose headers take longer than five minutes, and a non-streamed answer
 * sends its headers only when the whole generation is done.
 */
@Injectable()
export class GrokClient implements OnModuleDestroy {
  private readonly logger = new Logger(GrokClient.name);
  private readonly agent = new Agent({
    headersTimeout: GROK_SUMMARY_TIMEOUT_MS,
    bodyTimeout: GROK_SUMMARY_TIMEOUT_MS,
  });

  constructor(@Inject(DIGEST_CONFIG) private readonly config: DigestConfig) {}

  /** Closes the agent's keep-alive connections to xAI. */
  async onModuleDestroy(): Promise<void> {
    await this.agent.close();
  }

  async completeJson<T>(request: GrokJsonRequest<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.callOnce(request);
      } catch (error: unknown) {
        const grokError = toGrokError(error, request.isTimeoutRetryable ?? true);
        if (!grokError.isRetryable || attempt >= (request.maxRetries ?? GROK_MAX_RETRIES)) {
          this.logger.error(`Grok ${request.schemaName} failed: ${grokError.message}`);
          throw grokError;
        }
        await sleep((attempt + 1) * GROK_RETRY_BASE_DELAY_MS);
      }
    }
  }

  private async callOnce<T>(request: GrokJsonRequest<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? GROK_CALL_TIMEOUT_MS);
    try {
      const response = await fetch(GROK_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.grokApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.buildBody(request)),
        signal: controller.signal,
        dispatcher: this.agent,
      });
      // Awaited inside the try: the body is still streaming until parsed, and the timer guards it.
      return await parseAnswer(response, request);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildBody<T>(request: GrokJsonRequest<T>): Record<string, unknown> {
    const { grokReasoningEffort } = this.config;
    return {
      model: this.config.grokModel,
      ...(grokReasoningEffort === 'off' ? {} : { reasoning_effort: grokReasoningEffort }),
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

/** Network failures are retryable, aborts as the request says; the text never includes the request. */
function toGrokError(error: unknown, isTimeoutRetryable: boolean): GrokError {
  if (error instanceof GrokError) {
    return error;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new GrokError('timeout', isTimeoutRetryable);
  }
  return new GrokError(`network error (${error instanceof Error ? error.name : 'unknown'})`, true);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
