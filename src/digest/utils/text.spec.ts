import { batchBySize, truncateText } from './text';

const ELLIPSIS = '…';
const INPUT_MAX_CHARS = 20;
const INPUT_BUDGET = 10;

describe('truncateText', () => {
  it('returns text within the limit unchanged', () => {
    // Arrange
    const inputText = 'short fake text';

    // Act
    const actualText = truncateText(inputText, INPUT_MAX_CHARS);

    // Assert
    expect(actualText).toBe(inputText);
  });

  it('returns text of exactly the limit unchanged', () => {
    // Arrange
    const inputText = 'x'.repeat(INPUT_MAX_CHARS);

    // Act
    const actualText = truncateText(inputText, INPUT_MAX_CHARS);

    // Assert
    expect(actualText).toBe(inputText);
  });

  it('cuts at the last word boundary and marks the cut with an ellipsis', () => {
    // Arrange
    const inputText = 'alpha beta gamma delta epsilon';

    // Act
    const actualText = truncateText(inputText, INPUT_MAX_CHARS);

    // Assert
    expect(actualText).toBe(`alpha beta gamma${ELLIPSIS}`);
  });

  it('cuts inside a word when there is no space to break at', () => {
    // Arrange
    const inputText = 'y'.repeat(INPUT_MAX_CHARS * 2);

    // Act
    const actualText = truncateText(inputText, INPUT_MAX_CHARS);

    // Assert
    expect(actualText).toBe(`${'y'.repeat(INPUT_MAX_CHARS - 1)}${ELLIPSIS}`);
  });

  it('drops trailing spaces before the ellipsis', () => {
    // Arrange
    const inputText = `word${' '.repeat(INPUT_MAX_CHARS)}tail`;

    // Act
    const actualText = truncateText(inputText, INPUT_MAX_CHARS);

    // Assert
    expect(actualText).toBe(`word${ELLIPSIS}`);
  });

  it.each([1, 5, 11, 19, 20, 37])('never exceeds maxChars=%i', (inputMaxChars) => {
    // Arrange
    const inputText = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod';

    // Act
    const actualText = truncateText(inputText, inputMaxChars);

    // Assert
    expect(actualText.length).toBeLessThanOrEqual(inputMaxChars);
    expect(actualText.endsWith(ELLIPSIS)).toBe(true);
  });
});

describe('batchBySize', () => {
  const sizeOf = (item: string): number => item.length;

  it('returns no batches for no items', () => {
    // Act
    const actualBatches = batchBySize([], sizeOf, INPUT_BUDGET);

    // Assert
    expect(actualBatches).toEqual([]);
  });

  it('groups consecutive items while the summed size stays within the budget', () => {
    // Arrange
    const inputItems = ['aaaa', 'bbbb', 'cc', 'dddd', 'ee'];

    // Act
    const actualBatches = batchBySize(inputItems, sizeOf, INPUT_BUDGET);

    // Assert
    expect(actualBatches).toEqual([
      ['aaaa', 'bbbb', 'cc'],
      ['dddd', 'ee'],
    ]);
  });

  it('sends an item larger than the budget in a batch of its own', () => {
    // Arrange
    const inputOversized = 'z'.repeat(INPUT_BUDGET * 2);
    const inputItems = ['aa', inputOversized, 'bb'];

    // Act
    const actualBatches = batchBySize(inputItems, sizeOf, INPUT_BUDGET);

    // Assert
    expect(actualBatches).toEqual([['aa'], [inputOversized], ['bb']]);
  });

  it('keeps order, drops nothing and keeps every multi-item batch within the budget', () => {
    // Arrange
    const inputItems = Array.from({ length: 30 }, (_, index) => 'q'.repeat((index % 7) + 1));

    // Act
    const actualBatches = batchBySize(inputItems, sizeOf, INPUT_BUDGET);

    // Assert
    expect(actualBatches.flat()).toEqual(inputItems);
    for (const batch of actualBatches) {
      expect(batch.length).toBeGreaterThan(0);
      if (batch.length > 1) {
        expect(batch.reduce((sum, item) => sum + item.length, 0)).toBeLessThanOrEqual(INPUT_BUDGET);
      }
    }
  });
});
