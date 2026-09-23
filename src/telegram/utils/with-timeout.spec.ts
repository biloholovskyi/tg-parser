import { CONNECTION_LABEL, TIMEOUT_SUFFIX } from '../constants';
import { isConnectivityError } from './telegram-errors';
import { withTimeout } from './with-timeout';

const INPUT_TIMEOUT_MS = 5_000;
const INPUT_LABEL = 'Fake call';

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the value of the call', async () => {
    // Arrange
    const expectedValue = { ok: true };

    // Act
    const actualValue = await withTimeout(
      Promise.resolve(expectedValue),
      INPUT_TIMEOUT_MS,
      INPUT_LABEL,
    );

    // Assert
    expect(actualValue).toBe(expectedValue);
  });

  it('rejects with the labelled timeout error when the call never settles', async () => {
    // Arrange
    const inputCall = new Promise<never>(() => undefined);
    const actualResult = withTimeout(inputCall, INPUT_TIMEOUT_MS, INPUT_LABEL);
    const actualAssertion = expect(actualResult).rejects.toThrow(`${INPUT_LABEL} timeout`);

    // Act
    jest.advanceTimersByTime(INPUT_TIMEOUT_MS);

    // Assert
    await actualAssertion;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not time out before the deadline', async () => {
    // Arrange
    let resolveCall: (value: string) => void;
    const inputCall = new Promise<string>((resolve) => {
      resolveCall = resolve;
    });
    const actualResult = withTimeout(inputCall, INPUT_TIMEOUT_MS, INPUT_LABEL);

    // Act
    jest.advanceTimersByTime(INPUT_TIMEOUT_MS - 1);
    resolveCall('fake-value');

    // Assert
    await expect(actualResult).resolves.toBe('fake-value');
  });

  it('clears its timer once the call resolves', async () => {
    // Act
    await withTimeout(Promise.resolve('fake-value'), INPUT_TIMEOUT_MS, INPUT_LABEL);

    // Assert
    expect(jest.getTimerCount()).toBe(0);
  });

  it('propagates the rejection of the call and clears its timer', async () => {
    // Arrange
    const expectedError = new Error('fake call failure');

    // Act
    const actualResult = withTimeout(Promise.reject(expectedError), INPUT_TIMEOUT_MS, INPUT_LABEL);

    // Assert
    await expect(actualResult).rejects.toBe(expectedError);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the "Connection timeout" message for CONNECTION_LABEL, classified as connectivity', async () => {
    // Arrange
    const expectedMessage = 'Connection timeout';
    const actualResult = withTimeout(
      new Promise<never>(() => undefined),
      INPUT_TIMEOUT_MS,
      CONNECTION_LABEL,
    );
    const actualError = actualResult.catch((error: unknown) => error as Error);

    // Act
    jest.advanceTimersByTime(INPUT_TIMEOUT_MS);

    // Assert
    const actualSettled = await actualError;
    expect(actualSettled.message).toBe(expectedMessage);
    expect(actualSettled.message.endsWith(TIMEOUT_SUFFIX)).toBe(true);
    expect(isConnectivityError(actualSettled)).toBe(true);
  });
});
