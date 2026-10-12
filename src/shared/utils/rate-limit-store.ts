import { createHash } from 'crypto';

export interface RateLimitStoreOptions {
  maxRequests: number;
  windowMs: number;
  maxEntries: number;
}

export interface RateLimitDecision {
  isAllowed: boolean;
  retryAfterMs: number;
}

interface RateLimitWindow {
  hitCount: number;
  startedAtMs: number;
}

const ALLOWED_DECISION: RateLimitDecision = { isAllowed: true, retryAfterMs: 0 };

/** Subjects are phone numbers and caller keys, so only their digest is ever held. */
export function hashRateLimitSubject(subject: string): string {
  return createHash('sha256').update(subject).digest('hex');
}

/**
 * Fixed-window request counters kept in process memory.
 * The map is capped at maxEntries and expired windows are dropped on every use,
 * so a flood of unique subjects cannot grow it without bound. When the cap is reached
 * and every window is still live, a new subject is refused rather than allowed to
 * displace a live counter: a flood of unknown subjects must not reset a real one.
 */
export class RateLimitStore {
  private readonly windows = new Map<string, RateLimitWindow>();

  constructor(private readonly options: RateLimitStoreOptions) {}

  get size(): number {
    return this.windows.size;
  }

  consume(subject: string, nowMs: number = Date.now()): RateLimitDecision {
    const subjectKey = hashRateLimitSubject(subject);
    this.dropExpiredWindows(nowMs);

    const currentWindow = this.windows.get(subjectKey);
    if (!currentWindow) {
      return this.startWindow(subjectKey, nowMs);
    }

    if (currentWindow.hitCount < this.options.maxRequests) {
      currentWindow.hitCount += 1;
      return { ...ALLOWED_DECISION };
    }

    return { isAllowed: false, retryAfterMs: this.remainingWindowMs(currentWindow, nowMs) };
  }

  private startWindow(subjectKey: string, nowMs: number): RateLimitDecision {
    if (this.windows.size >= this.options.maxEntries) {
      return { isAllowed: false, retryAfterMs: this.oldestRemainingWindowMs(nowMs) };
    }

    this.windows.set(subjectKey, { hitCount: 1, startedAtMs: nowMs });

    return { ...ALLOWED_DECISION };
  }

  /** Windows are inserted in start order and never re-inserted, so the first one is the oldest. */
  private oldestRemainingWindowMs(nowMs: number): number {
    const oldestWindow = this.windows.values().next().value as RateLimitWindow | undefined;

    return oldestWindow ? this.remainingWindowMs(oldestWindow, nowMs) : 0;
  }

  private dropExpiredWindows(nowMs: number): void {
    for (const [subjectKey, window] of this.windows) {
      if (this.remainingWindowMs(window, nowMs) === 0) {
        this.windows.delete(subjectKey);
      }
    }
  }

  private remainingWindowMs(window: RateLimitWindow, nowMs: number): number {
    const remainingMs = window.startedAtMs + this.options.windowMs - nowMs;

    return remainingMs > 0 ? remainingMs : 0;
  }
}
