/** A digest run stopped because the application is shutting down; nothing is sent for it. */
export class DigestCancelledError extends Error {
  constructor() {
    super('Digest run cancelled');
    this.name = 'DigestCancelledError';
  }
}

export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DigestCancelledError();
  }
}

/**
 * Waits `ms`, or rejects with DigestCancelledError as soon as `signal` aborts. The timer is
 * cleared on both paths and never holds the process open.
 */
export function delayUnlessCancelled(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DigestCancelledError());
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DigestCancelledError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    timer.unref();
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
