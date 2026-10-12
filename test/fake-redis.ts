import type Redis from 'ioredis';

/** One recorded command: its name and every argument, for key and value hygiene assertions. */
export interface FakeRedisCall {
  command: 'get' | 'set' | 'del' | 'expire';
  args: unknown[];
}

/**
 * In-memory stand-in for the four ioredis commands SessionRepository uses. No socket, no timers:
 * TTLs are only recorded, never enforced. `failNext`/`failAll` make commands reject like an outage.
 */
export class FakeRedis {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  readonly calls: FakeRedisCall[] = [];
  private failure: Error | undefined;
  private failOnce = false;

  /** Every command rejects with this error until `recover()`. */
  failAll(error: Error = new Error('fake ECONNREFUSED')): void {
    this.failure = error;
    this.failOnce = false;
  }

  /** Only the next command rejects. */
  failNext(error: Error = new Error('fake ECONNREFUSED')): void {
    this.failure = error;
    this.failOnce = true;
  }

  recover(): void {
    this.failure = undefined;
    this.failOnce = false;
  }

  async get(key: string): Promise<string | null> {
    this.record('get', [key]);
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, ...options: unknown[]): Promise<'OK'> {
    this.record('set', [key, value, ...options]);
    this.values.set(key, value);
    const exIndex = options.indexOf('EX');
    if (exIndex >= 0) {
      this.ttls.set(key, Number(options[exIndex + 1]));
    } else {
      this.ttls.delete(key);
    }
    return 'OK';
  }

  async del(key: string): Promise<number> {
    this.record('del', [key]);
    this.ttls.delete(key);
    return this.values.delete(key) ? 1 : 0;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.record('expire', [key, seconds]);
    if (!this.values.has(key)) {
      return 0;
    }
    this.ttls.set(key, seconds);
    return 1;
  }

  /** Every key any command was ever called with, including keys written then deleted. */
  touchedKeys(): string[] {
    return this.calls.map((call) => String(call.args[0]));
  }

  asRedis(): Redis {
    return this as unknown as Redis;
  }

  private record(command: FakeRedisCall['command'], args: unknown[]): void {
    this.calls.push({ command, args });
    if (this.failure) {
      const error = this.failure;
      if (this.failOnce) {
        this.recover();
      }
      throw error;
    }
  }
}
