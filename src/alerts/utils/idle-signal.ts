/**
 * Lets shutdown wait until the alert queue is empty, with a ceiling. Each waiter's timer is
 * cleared when it is released early; a waiter released by its timer is dropped on the next notify.
 */
export class IdleSignal {
  private waiters: Array<() => void> = [];

  /** Resolves on the next `notify` or after `timeoutMs`, whichever comes first. */
  wait(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((release) => release());
  }
}
