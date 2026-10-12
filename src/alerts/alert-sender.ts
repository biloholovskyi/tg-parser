import { HttpStatus } from '@nestjs/common';
import type { AlertsConfig } from '../config/alerts.config';
import {
  ALERTS_INGEST_PATH,
  ALERT_CALL_TIMEOUT_MS,
  ALERT_MAX_RETRIES,
  ALERT_RETRY_DELAY_MS,
} from './constants';
import type { AlertPayload } from './interfaces/alert.interface';

const API_KEY_HEADER = 'X-API-Key';
const ABORT_ERROR_NAME = 'AbortError';

/** A failed alert request; the message carries a status or a reason, never the URL or the key. */
export class AlertSendError extends Error {
  constructor(
    message: string,
    readonly isRetryable: boolean,
  ) {
    super(message);
    this.name = 'AlertSendError';
  }
}

export type AlertTarget = Pick<AlertsConfig, 'url' | 'apiKey'>;

/**
 * Sends one alert: up to ALERT_MAX_RETRIES extra attempts after a network failure, a timeout or
 * a 5xx; a 4xx is final. `signal` aborts the request and any pending retry, for shutdown.
 */
export async function sendAlert(
  target: AlertTarget,
  payload: AlertPayload,
  signal?: AbortSignal,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sendOnce(target, payload, signal);
    } catch (error: unknown) {
      const sendError = toSendError(error, signal);
      if (!sendError.isRetryable || attempt >= ALERT_MAX_RETRIES) {
        throw sendError;
      }
      await delay(ALERT_RETRY_DELAY_MS, signal);
    }
  }
}

async function sendOnce(
  target: AlertTarget,
  payload: AlertPayload,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new AlertSendError('aborted', false);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ALERT_CALL_TIMEOUT_MS);
  const abortFromCaller = (): void => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const response = await fetch(`${target.url}${ALERTS_INGEST_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [API_KEY_HEADER]: target.apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new AlertSendError(
        `HTTP ${response.status}`,
        response.status >= HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Timeouts and network failures are retryable unless the caller aborted. */
function toSendError(error: unknown, signal?: AbortSignal): AlertSendError {
  if (signal?.aborted) {
    return new AlertSendError('aborted', false);
  }
  if (error instanceof AlertSendError) {
    return error;
  }
  if (error instanceof Error && error.name === ABORT_ERROR_NAME) {
    return new AlertSendError('timeout', true);
  }
  return new AlertSendError(
    `network error (${error instanceof Error ? error.name : 'unknown'})`,
    true,
  );
}

/** Waits before a retry; an abort ends the wait at once and clears the timer. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AlertSendError('aborted', false));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new AlertSendError('aborted', false));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
