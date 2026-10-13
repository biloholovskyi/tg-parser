import { FailureLogThrottle } from './failure-log-throttle';

const WINDOW_MS = 600_000;
const START_MS = 1_000_000;

describe('FailureLogThrottle', () => {
  let currentTime: number;
  let throttle: FailureLogThrottle;

  beforeEach(() => {
    currentTime = START_MS;
    throttle = new FailureLogThrottle(WINDOW_MS, () => currentTime);
  });

  it('reports the first failure at once with a count of one', () => {
    // Act
    const actualCount = throttle.record();

    // Assert
    expect(actualCount).toBe(1);
  });

  it('returns null for failures inside the window', () => {
    // Arrange
    throttle.record();
    currentTime += WINDOW_MS - 1;

    // Act
    const actualSecond = throttle.record();
    const actualThird = throttle.record();

    // Assert
    expect(actualSecond).toBeNull();
    expect(actualThird).toBeNull();
  });

  it('reports every failure since the last report once the window has passed', () => {
    // Arrange
    throttle.record();
    throttle.record();
    throttle.record();
    currentTime += WINDOW_MS;

    // Act
    const actualCount = throttle.record();

    // Assert
    expect(actualCount).toBe(3);
  });

  it('starts a new window from the last report', () => {
    // Arrange
    throttle.record();
    currentTime += WINDOW_MS;
    throttle.record();
    currentTime += WINDOW_MS - 1;

    // Act
    const actualInsideNewWindow = throttle.record();
    currentTime += 1;
    const actualAfterNewWindow = throttle.record();

    // Assert
    expect(actualInsideNewWindow).toBeNull();
    expect(actualAfterNewWindow).toBe(2);
  });

  it('reads Date.now when no clock is given', () => {
    // Arrange
    jest.useFakeTimers({ now: START_MS });
    const defaultThrottle = new FailureLogThrottle(WINDOW_MS);
    defaultThrottle.record();

    // Act
    const actualInside = defaultThrottle.record();
    jest.advanceTimersByTime(WINDOW_MS);
    const actualAfter = defaultThrottle.record();
    jest.useRealTimers();

    // Assert
    expect(actualInside).toBeNull();
    expect(actualAfter).toBe(2);
  });
});
