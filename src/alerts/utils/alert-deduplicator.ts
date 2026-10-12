interface DedupEntry {
  windowStartedAt: number;
  suppressedCount: number;
}

export interface DedupDecision {
  isSuppressed: boolean;
  /** Repeats suppressed in the previous window of this key, reported with the alert that opens a new one. */
  previousSuppressedCount: number;
}

/**
 * Lets one alert per key through per window and counts the rest. The map is bounded: beyond
 * `maxKeys` the key whose window opened first is forgotten.
 */
export class AlertDeduplicator {
  private readonly entries = new Map<string, DedupEntry>();

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys: number,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): DedupDecision {
    const currentTime = this.now();
    const entry = this.entries.get(key);
    if (entry && currentTime - entry.windowStartedAt < this.windowMs) {
      entry.suppressedCount++;
      return { isSuppressed: true, previousSuppressedCount: 0 };
    }
    // Re-inserted, so the map's insertion order is the order windows opened in.
    this.entries.delete(key);
    this.entries.set(key, { windowStartedAt: currentTime, suppressedCount: 0 });
    this.forgetOldest();
    return { isSuppressed: false, previousSuppressedCount: entry?.suppressedCount ?? 0 };
  }

  get size(): number {
    return this.entries.size;
  }

  private forgetOldest(): void {
    while (this.entries.size > this.maxKeys) {
      const [oldestKey] = this.entries.keys();
      this.entries.delete(oldestKey);
    }
  }
}
