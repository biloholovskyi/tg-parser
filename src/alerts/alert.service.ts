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
  AlertGate,
  AlertLevel,
  AlertPayload,
} from './interfaces/alert.interface';
import { AlertDeduplicator } from './utils/alert-deduplicator';
import { FailureLogThrottle } from './utils/failure-log-throttle';
import { IdleSignal } from './utils/idle-signal';

/**
 * Reports alerts to the alert service in the background. A call queues the alert and returns at
 * once; nothing here ever throws to the caller. The queue, the concurrency and the dedup map are
 * bounded. `beginShutdown` stops accepting new alerts, and the shutdown hook waits for the queue
 * at most ALERT_DRAIN_TIMEOUT_MS.
 */
@Injectable()
export class AlertService implements AlertGate, OnApplicationShutdown {
  private readonly logger = new Logger(AlertService.name);
  private readonly queue: AlertPayload[] = [];
  private readonly deduplicator = new AlertDeduplicator(
    ALERT_DEDUP_WINDOW_MS,
    ALERT_DEDUP_MAX_KEYS,
  );
  private readonly failureLog = new FailureLogThrottle(ALERT_DEDUP_WINDOW_MS);
  private readonly idle = new IdleSignal();
  private readonly shutdown = new AbortController();
  private isAccepting = true;
  private inFlightCount = 0;
  private droppedCount = 0;

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

  /**
   * Stops accepting alerts while queued ones still go out: requests cut off by a deliberate
   * shutdown would otherwise report themselves as failures on every deploy.
   */
  beginShutdown(): void {
    this.isAccepting = false;
  }

  /** Waits for queued alerts up to ALERT_DRAIN_TIMEOUT_MS, then aborts what is still running. */
  async onApplicationShutdown(): Promise<void> {
    this.isAccepting = false;
    if (!this.isIdle) {
      await this.idle.wait(ALERT_DRAIN_TIMEOUT_MS);
    }
    this.queue.length = 0;
    this.shutdown.abort();
  }

  private get isIdle(): boolean {
    return this.inFlightCount === 0 && this.queue.length === 0;
  }

  private enqueue(level: AlertLevel, message: string, details?: AlertDetails): void {
    if (!this.config.isEnabled || !this.isAccepting) {
      return;
    }
    try {
      // A full queue drops the alert before it can open a dedup window it never used.
      if (this.queue.length >= ALERT_QUEUE_MAX_SIZE) {
        this.droppedCount++;
        return;
      }
      const counters = this.takeCounters(level, message);
      if (!counters) {
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
    if (this.droppedCount > 0) {
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
      if (this.isIdle) {
        this.idle.notify();
      }
    }
  }

  /** One log line per ALERT_DEDUP_WINDOW_MS while the alert service keeps failing. */
  private logFailure(error: unknown): void {
    const failedCount = this.failureLog.record();
    if (failedCount === null) {
      return;
    }
    const reason = error instanceof Error ? error.message : 'unknown';
    this.logger.warn(`Alert not delivered: ${reason} (${failedCount} failed since last report)`);
  }
}
