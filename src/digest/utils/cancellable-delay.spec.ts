import { DigestCancelledError, delayUnlessCancelled, throwIfCancelled } from './cancellable-delay';

const INPUT_DELAY_MS = 5000;

type Outcome = unknown;

/** Tracks how a promise settled without awaiting it, so fake time can be stepped in between. */
function track(promise: Promise<void>): { readonly outcome: Outcome } {
  const state: { outcome: Outcome } = { outcome: 'pending' };
  promise.then(
    () => {
      state.outcome = 'resolved';
    },
    (error: unknown) => {
      state.outcome = error;
    },
  );
  return state;
}

describe('throwIfCancelled', () => {
  it('does nothing for a signal that has not aborted', () => {
    // Arrange
    const inputController = new AbortController();

    // Act
    const actualCall = (): void => throwIfCancelled(inputController.signal);

    // Assert
    expect(actualCall).not.toThrow();
  });

  it('throws DigestCancelledError for an aborted signal', () => {
    // Arrange
    const inputController = new AbortController();
    inputController.abort();

    // Act
    const actualCall = (): void => throwIfCancelled(inputController.signal);

    // Assert
    expect(actualCall).toThrow(DigestCancelledError);
  });
});

describe('DigestCancelledError', () => {
  it('carries its own name and a fixed message', () => {
    // Act
    const actualError = new DigestCancelledError();

    // Assert
    expect(actualError).toBeInstanceOf(Error);
    expect(actualError.name).toBe('DigestCancelledError');
    expect(actualError.message).toBe('Digest run cancelled');
  });
});

describe('delayUnlessCancelled', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('resolves only once the full delay has passed and leaves no timer behind', async () => {
    // Arrange
    const inputController = new AbortController();

    // Act
    const actualState = track(delayUnlessCancelled(INPUT_DELAY_MS, inputController.signal));
    await jest.advanceTimersByTimeAsync(INPUT_DELAY_MS - 1);
    const actualBeforeDeadline = actualState.outcome;
    const actualTimersWhileWaiting = jest.getTimerCount();
    await jest.advanceTimersByTimeAsync(1);

    // Assert
    expect(actualBeforeDeadline).toBe('pending');
    expect(actualTimersWhileWaiting).toBe(1);
    expect(actualState.outcome).toBe('resolved');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('removes its abort listener once the delay resolves', async () => {
    // Arrange
    const inputController = new AbortController();
    const mockRemove = jest.spyOn(inputController.signal, 'removeEventListener');
    const mockAdd = jest.spyOn(inputController.signal, 'addEventListener');

    // Act
    const actualPromise = delayUnlessCancelled(INPUT_DELAY_MS, inputController.signal);
    await jest.advanceTimersByTimeAsync(INPUT_DELAY_MS);
    await actualPromise;

    // Assert
    expect(mockAdd).toHaveBeenCalledTimes(1);
    const [[expectedType, expectedListener]] = mockAdd.mock.calls;
    expect(mockRemove).toHaveBeenCalledWith(expectedType, expectedListener);
  });

  it('rejects with DigestCancelledError at once when aborted mid-wait and clears the timer', async () => {
    // Arrange
    const inputController = new AbortController();
    const mockClearTimeout = jest.spyOn(global, 'clearTimeout');
    const actualState = track(delayUnlessCancelled(INPUT_DELAY_MS, inputController.signal));
    await jest.advanceTimersByTimeAsync(INPUT_DELAY_MS / 2);

    // Act
    inputController.abort();
    await Promise.resolve();

    // Assert
    expect(actualState.outcome).toBeInstanceOf(DigestCancelledError);
    expect(mockClearTimeout).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects immediately without arming a timer when the signal is already aborted', async () => {
    // Arrange
    const inputController = new AbortController();
    inputController.abort();
    const mockSetTimeout = jest.spyOn(global, 'setTimeout');

    // Act
    // Awaited the way callers do: the helper currently throws synchronously here instead of
    // returning a rejected promise, which an `await` turns into the same rejection.
    const actualPromise = (async (): Promise<void> =>
      delayUnlessCancelled(INPUT_DELAY_MS, inputController.signal))();

    // Assert
    await expect(actualPromise).rejects.toBeInstanceOf(DigestCancelledError);
    expect(mockSetTimeout).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('unrefs its timer so a pending wait never holds the process open', async () => {
    // Arrange
    const inputController = new AbortController();
    const mockUnref = jest.fn();
    const realSetTimeout = global.setTimeout;
    jest.spyOn(global, 'setTimeout').mockImplementation(((
      handler: () => void,
      ms?: number,
    ): NodeJS.Timeout => {
      const timer = realSetTimeout(handler, ms);
      jest.spyOn(timer, 'unref').mockImplementation(() => {
        mockUnref();
        return timer;
      });
      return timer;
    }) as unknown as typeof setTimeout);

    // Act
    const actualPromise = delayUnlessCancelled(INPUT_DELAY_MS, inputController.signal);
    inputController.abort();

    // Assert
    await expect(actualPromise).rejects.toBeInstanceOf(DigestCancelledError);
    expect(mockUnref).toHaveBeenCalledTimes(1);
  });
});
