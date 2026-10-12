/** The part of a Telegram client the cache needs: a way to release it for good. */
export interface ReleasableClient {
  destroy(): Promise<void>;
}

export interface SessionClientCacheOptions {
  maxEntries: number;
  idleTtlMs: number;
  sweepIntervalMs: number;
  now?: () => number;
}

interface CacheEntry<T> {
  client: T;
  lastUsedAt: number;
}

/**
 * Bounded cache of live clients keyed by session string.
 * Every entry leaves the cache through `evict`, which always releases the client:
 * on the size ceiling (least recently used first), on idle expiry, on demand, and on shutdown.
 */
export class SessionClientCache<T extends ReleasableClient> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly now: () => number;
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: SessionClientCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Returns the client and marks it as the most recently used. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    this.touch(key, entry);
    return entry.client;
  }

  /** Stores a client, releasing the least recently used one when the ceiling is reached. */
  async set(key: string, client: T): Promise<void> {
    const existing = this.entries.get(key);
    if (existing && existing.client !== client) {
      await this.evict(key);
    }
    while (!this.entries.has(key) && this.entries.size >= this.options.maxEntries) {
      await this.evict(this.entries.keys().next().value as string);
    }
    this.touch(key, { client, lastUsedAt: 0 });
  }

  /** Removes the entry and releases its client. */
  async evict(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    this.entries.delete(key);
    await releaseQuietly(entry.client);
  }

  /** Evicts every entry idle for longer than the TTL. */
  async sweepIdle(): Promise<void> {
    const cutoff = this.now() - this.options.idleTtlMs;
    const expired = [...this.entries].filter(([, entry]) => entry.lastUsedAt <= cutoff);
    await Promise.all(expired.map(([key]) => this.evict(key)));
  }

  startSweeping(): void {
    if (this.sweepTimer) {
      return;
    }
    this.sweepTimer = setInterval(() => void this.sweepIdle(), this.options.sweepIntervalMs);
    this.sweepTimer.unref();
  }

  /** Stops the sweep and releases every cached client. */
  async close(): Promise<void> {
    clearInterval(this.sweepTimer);
    this.sweepTimer = undefined;
    await Promise.all([...this.entries.keys()].map((key) => this.evict(key)));
  }

  private touch(key: string, entry: CacheEntry<T>): void {
    // Re-inserting keeps Map order equal to recency, so the first key is the eviction candidate.
    this.entries.delete(key);
    this.entries.set(key, { client: entry.client, lastUsedAt: this.now() });
  }
}

async function releaseQuietly(client: ReleasableClient): Promise<void> {
  try {
    await client.destroy();
  } catch {
    // Release failures are not actionable: the entry is already gone and the socket is dead.
  }
}
