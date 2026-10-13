/**
 * Counts delivery failures and lets one log line through per window, so an alert service outage
 * costs one line per window instead of one per alert.
 */
export class FailureLogThrottle {
  private failedCount = 0;
  private lastReportedAt?: number;

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records one failure; returns the failures to report now, or null inside the window. */
  record(): number | null {
    this.failedCount++;
    const currentTime = this.now();
    if (this.lastReportedAt !== undefined && currentTime - this.lastReportedAt < this.windowMs) {
      return null;
    }
    const reported = this.failedCount;
    this.lastReportedAt = currentTime;
    this.failedCount = 0;
    return reported;
  }
}
