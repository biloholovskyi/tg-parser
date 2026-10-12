import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import type { AlertsConfig } from '../config/alerts.config';
import { buildAlertPayload } from './alert-sanitizer';
import { sendAlert } from './alert-sender';
import {
  ALERTS_CONFIG,
  ALERT_DEDUP_MAX_KEYS,
  ALERT_DEDUP_WINDOW_MS,
  ALERT_DRAIN_TIMEOUT_MS,
  ALERT_MAX_CONCURRENT,
  ALERT_QUEUE_MAX_SIZE,
} from './constants';
import type {
  AlertDetails,
  AlertLevel,
  AlertPayload,
  AlertSink,
} from './interfaces/alert.interface';
import { AlertDeduplicator } from './utils/alert-deduplicator';

/**
 * Reports alerts to the alert service in the background. A call queues the alert and returns at
 * once; nothing here ever throws to the caller. The queue, the concurrency and the dedup map are
 * bounded, and shutdown waits for the queue at most ALERT_DRAIN_TIMEOUT_MS.
 */
@Injectable()
export class AlertService implements AlertSink, OnApplicationShutdown {
  private readonly logger = new Logger(AlertService.name);
  private readonly queue: AlertPayload[] = [];
  private readonly deduplicator = new AlertDeduplicator(
    ALERT_DEDUP_WINDOW_MS,
    ALERT_DEDUP_MAX_KEYS,
  );
  private readonly shutdown = new AbortController();
  private idleWaiters: Array<() => void> = [];
  private inFlightCount = 0;
  private droppedCount = 0;
  private failedCount = 0;
  private lastFailureLoggedAt?: number;

  constructor(@Inject(ALERTS_CONFIG) private readonly config: AlertsConfig) {}

  /** Normal events worth knowing about; never deduplicated. */
  info(message: string, details?: AlertDetails): void {
    this.enqueue('info', message, details);
  }

  /** Degraded but working; repeats inside ALERT_DEDUP_WINDOW_MS are counted, not sent. */
  warning(message: string, details?: AlertDetails): void {
    this.enqueue('warning', message, details);
  }

  /** Something failed; repeats inside ALERT_DEDUP_WINDOW_MS are counted, not sent. */
  error(message: string, details?: AlertDetails): void {
    this.enqueue('error', message, details);
  }

  /** Waits for queued alerts up to ALERT_DRAIN_TIMEOUT_MS, then aborts what is still running. */
  async onApplicationShutdown(): Promise<void> {
    await this.waitForIdle(ALERT_DRAIN_TIMEOUT_MS);
    this.queue.length = 0;
    this.shutdown.abort();
  }

  private enqueue(level: AlertLevel, message: string, details?: AlertDetails): void {
    if (!this.config.isEnabled || this.shutdown.signal.aborted) {
      return;
    }
    try {
      const counters = this.takeCounters(level, message);
      if (!counters) {
        return;
      }
      if (this.queue.length >= ALERT_QUEUE_MAX_SIZE) {
        this.droppedCount++;
        return;
      }
      const merged = Object.keys(counters).length > 0 ? { ...details, ...counters } : details;
      this.queue.push(buildAlertPayload(this.config.serviceName, level, message, merged));
      this.pump();
    } catch {
      // An alert must never break the code that reports it.
    }
  }

  /** Counters to attach to this alert, or null when it repeats one sent inside the window. */
  private takeCounters(level: AlertLevel, message: string): Record<string, number> | null {
    const counters: Record<string, number> = {};
    if (level !== 'info') {
      const decision = this.deduplicator.check(`${level}:${message}`);
      if (decision.isSuppressed) {
        return null;
      }
      if (decision.previousSuppressedCount > 0) {
        counters.suppressedRepeats = decision.previousSuppressedCount;
      }
    }
    if (this.droppedCount > 0 && this.queue.length < ALERT_QUEUE_MAX_SIZE) {
      counters.droppedAlerts = this.droppedCount;
      this.droppedCount = 0;
    }
    return counters;
  }

  private pump(): void {
    while (this.inFlightCount < ALERT_MAX_CONCURRENT && this.queue.length > 0) {
      const payload = this.queue.shift() as AlertPayload;
      this.inFlightCount++;
      void this.deliver(payload);
    }
  }

  private async deliver(payload: AlertPayload): Promise<void> {
    try {
      await sendAlert(this.config, payload, this.shutdown.signal);
    } catch (error: unknown) {
      // A send cut off by shutdown is expected and not worth a log line.
      if (!this.shutdown.signal.aborted) {
        this.logFailure(error);
      }
    } finally {
      this.inFlightCount--;
      this.pump();
      this.notifyIfIdle();
    }
  }

  /** One log line per ALERT_DEDUP_WINDOW_MS while the alert service keeps failing. */
  private logFailure(error: unknown): void {
    this.failedCount++;
    const now = Date.now();
    if (
      this.lastFailureLoggedAt !== undefined &&
      now - this.lastFailureLoggedAt < ALERT_DEDUP_WINDOW_MS
    ) {
      return;
    }
    const reason = error instanceof Error ? error.message : 'unknown';
    this.logger.warn(
      `Alert not delivered: ${reason} (${this.failedCount} failed since last report)`,
    );
    this.lastFailureLoggedAt = now;
    this.failedCount = 0;
  }

  private notifyIfIdle(): void {
    if (this.inFlightCount === 0 && this.queue.length === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }

  private waitForIdle(timeoutMs: number): Promise<void> {
    if (this.inFlightCount === 0 && this.queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.idleWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
