import { AlertDeduplicator } from './alert-deduplicator';

const WINDOW_MS = 1000;
const MAX_KEYS = 3;

describe('AlertDeduplicator', () => {
  let mockNow: number;
  let deduplicator: AlertDeduplicator;

  beforeEach(() => {
    mockNow = 0;
    deduplicator = new AlertDeduplicator(WINDOW_MS, MAX_KEYS, () => mockNow);
  });

  it('lets the first occurrence of a key through', () => {
    // Act
    const actualDecision = deduplicator.check('error:boom');

    // Assert
    expect(actualDecision).toEqual({ isSuppressed: false, previousSuppressedCount: 0 });
  });

  it('suppresses repeats inside the window', () => {
    // Arrange
    deduplicator.check('error:boom');
    mockNow = WINDOW_MS - 1;

    // Act
    const actualDecision = deduplicator.check('error:boom');

    // Assert
    expect(actualDecision).toEqual({ isSuppressed: true, previousSuppressedCount: 0 });
  });

  it('lets a key through after the window with the count of suppressed repeats', () => {
    // Arrange
    const inputRepeats = 3;
    deduplicator.check('error:boom');
    for (let index = 0; index < inputRepeats; index++) {
      deduplicator.check('error:boom');
    }
    mockNow = WINDOW_MS;

    // Act
    const actualDecision = deduplicator.check('error:boom');

    // Assert
    expect(actualDecision).toEqual({ isSuppressed: false, previousSuppressedCount: inputRepeats });
  });

  it('starts a new window, so the count resets after it is reported', () => {
    // Arrange
    deduplicator.check('error:boom');
    deduplicator.check('error:boom');
    mockNow = WINDOW_MS;
    deduplicator.check('error:boom');
    mockNow = WINDOW_MS * 2;

    // Act
    const actualDecision = deduplicator.check('error:boom');

    // Assert
    expect(actualDecision).toEqual({ isSuppressed: false, previousSuppressedCount: 0 });
  });

  it('keeps keys independent', () => {
    // Arrange
    deduplicator.check('error:a');

    // Act
    const actualDecision = deduplicator.check('error:b');

    // Assert
    expect(actualDecision.isSuppressed).toBe(false);
  });

  it('never holds more than maxKeys and forgets the oldest window first', () => {
    // Arrange
    ['k1', 'k2', 'k3', 'k4'].forEach((key) => deduplicator.check(key));

    // Act
    const actualOldest = deduplicator.check('k1');
    const actualNewest = deduplicator.check('k4');

    // Assert
    expect(deduplicator.size).toBeLessThanOrEqual(MAX_KEYS);
    expect(actualOldest.isSuppressed).toBe(false);
    expect(actualNewest.isSuppressed).toBe(true);
  });

  it('stays bounded under many distinct keys', () => {
    // Arrange
    const inputKeyCount = 50;

    // Act
    for (let index = 0; index < inputKeyCount; index++) {
      deduplicator.check(`key-${index}`);
    }

    // Assert
    expect(deduplicator.size).toBe(MAX_KEYS);
  });
});
