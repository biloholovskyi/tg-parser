import { IdleSignal } from './idle-signal';

const TIMEOUT_MS = 5000;

describe('IdleSignal', () => {
  let signal: IdleSignal;

  beforeEach(() => {
    jest.useFakeTimers();
    signal = new IdleSignal();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function track(promise: Promise<void>): { isResolved: () => boolean } {
    let isResolved = false;
    void promise.then(() => {
      isResolved = true;
    });
    return { isResolved: () => isResolved };
  }

  it('resolves a waiter on notify and clears its timer', async () => {
    // Arrange
    const actualWait = track(signal.wait(TIMEOUT_MS));
    const actualTimersWhileWaiting = jest.getTimerCount();

    // Act
    signal.notify();
    await jest.advanceTimersByTimeAsync(0);

    // Assert
    expect(actualTimersWhileWaiting).toBe(1);
    expect(actualWait.isResolved()).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resolves a waiter after the timeout without a notify', async () => {
    // Arrange
    const actualWait = track(signal.wait(TIMEOUT_MS));

    // Act
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    const actualResolvedEarly = actualWait.isResolved();
    await jest.advanceTimersByTimeAsync(1);

    // Assert
    expect(actualResolvedEarly).toBe(false);
    expect(actualWait.isResolved()).toBe(true);
  });

  it('releases every waiter on one notify', async () => {
    // Arrange
    const actualFirst = track(signal.wait(TIMEOUT_MS));
    const actualSecond = track(signal.wait(TIMEOUT_MS));

    // Act
    signal.notify();
    await jest.advanceTimersByTimeAsync(0);

    // Assert
    expect(actualFirst.isResolved()).toBe(true);
    expect(actualSecond.isResolved()).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not release a waiter registered after a notify', async () => {
    // Arrange
    signal.notify();

    // Act
    const actualWait = track(signal.wait(TIMEOUT_MS));
    await jest.advanceTimersByTimeAsync(0);

    // Assert
    expect(actualWait.isResolved()).toBe(false);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('tolerates a notify after a waiter was released by its timer', async () => {
    // Arrange
    const actualWait = track(signal.wait(TIMEOUT_MS));
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);

    // Act
    const actualNotify = (): void => signal.notify();

    // Assert
    expect(actualNotify).not.toThrow();
    expect(actualWait.isResolved()).toBe(true);
  });
});
