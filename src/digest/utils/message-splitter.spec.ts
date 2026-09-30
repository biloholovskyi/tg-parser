import { splitMessages } from './message-splitter';

const INPUT_MAX_CHARS = 20;
const BLOCK_SEPARATOR = '\n\n';
const PROPERTY_RUNS = 200;
const PROPERTY_MAX_BLOCKS = 12;
const PROPERTY_MAX_LINES = 6;
const PROPERTY_MAX_LINE_CHARS = 45;
const PROPERTY_MAX_CHARS_FLOOR = 10;
const PROPERTY_MAX_CHARS_SPAN = 40;
const ALPHABET = ['a', 'b', 'я', ' ', '&amp;', '&lt;', '&gt;', 'x'];
const ENTITY_PATTERN = /&(?:amp|lt|gt|quot);/g;

/** Deterministic pseudo-random generator, so a failing case is reproducible. */
function createRandom(seed: number): (limit: number) => number {
  let state = seed;
  return (limit: number) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % limit;
  };
}

function withoutWhitespace(text: string): string {
  return text.replace(/\s/g, '');
}

function hasBrokenEntity(message: string): boolean {
  const withoutEntities = message.replace(ENTITY_PATTERN, '');
  return withoutEntities.includes('&');
}

describe('splitMessages', () => {
  it('packs blocks into one message joined by a blank line when they fit', () => {
    // Arrange
    const inputBlocks = ['one', 'two', 'three'];

    // Act
    const actualMessages = splitMessages(inputBlocks, INPUT_MAX_CHARS);

    // Assert
    expect(actualMessages).toEqual(['one\n\ntwo\n\nthree']);
  });

  it('keeps two blocks together when their joined length is exactly the limit', () => {
    // Arrange
    const halfLength = (INPUT_MAX_CHARS - BLOCK_SEPARATOR.length) / 2;
    const inputBlocks = ['a'.repeat(halfLength), 'b'.repeat(halfLength)];

    // Act
    const actualMessages = splitMessages(inputBlocks, INPUT_MAX_CHARS);

    // Assert
    expect(actualMessages).toHaveLength(1);
    expect(actualMessages[0]).toHaveLength(INPUT_MAX_CHARS);
  });

  it('cuts between blocks when the joined length is one over the limit', () => {
    // Arrange
    const halfLength = (INPUT_MAX_CHARS - BLOCK_SEPARATOR.length) / 2;
    const inputBlocks = ['a'.repeat(halfLength), 'b'.repeat(halfLength + 1)];

    // Act
    const actualMessages = splitMessages(inputBlocks, INPUT_MAX_CHARS);

    // Assert
    expect(actualMessages).toEqual(inputBlocks);
  });

  it('keeps a single block of exactly the limit whole', () => {
    // Arrange
    const inputBlock = 'c'.repeat(INPUT_MAX_CHARS);

    // Act
    const actualMessages = splitMessages([inputBlock], INPUT_MAX_CHARS);

    // Assert
    expect(actualMessages).toEqual([inputBlock]);
  });

  it('cuts a block longer than the limit between its lines, keeping line order', () => {
    // Arrange
    const inputBlock = ['line-one-1', 'line-two-2', 'line-three'].join('\n');

    // Act
    const actualMessages = splitMessages([inputBlock], INPUT_MAX_CHARS);

    // Assert
    expect(actualMessages).toEqual(['line-one-1', 'line-two-2', 'line-three']);
    for (const message of actualMessages) {
      expect(message.length).toBeLessThanOrEqual(INPUT_MAX_CHARS);
    }
  });

  it('packs lines of an oversize block together while they fit', () => {
    // Arrange
    const inputBlock = ['aaaa', 'bbbb', 'cccc', 'dddd', 'eeeeeeeeeeeeeeeeee'].join('\n');

    // Act
    const actualMessages = splitMessages([inputBlock], INPUT_MAX_CHARS);

    // Assert
    expect(actualMessages).toEqual(['aaaa\nbbbb\ncccc\ndddd', 'eeeeeeeeeeeeeeeeee']);
  });

  it('cuts a single line longer than the limit by characters without losing any', () => {
    // Arrange
    const inputLine = 'z'.repeat(INPUT_MAX_CHARS * 2 + 3);

    // Act
    const actualMessages = splitMessages([inputLine], INPUT_MAX_CHARS);

    // Assert
    expect(actualMessages.join('')).toBe(inputLine);
    for (const message of actualMessages) {
      expect(message.length).toBeLessThanOrEqual(INPUT_MAX_CHARS);
    }
  });

  it('never cuts inside an HTML entity that straddles the limit', () => {
    // Arrange: the limit falls in the middle of "&amp;".
    const prefixLength = INPUT_MAX_CHARS - 2;
    const inputLine = `${'y'.repeat(prefixLength)}&amp;${'y'.repeat(INPUT_MAX_CHARS)}`;

    // Act
    const actualMessages = splitMessages([inputLine], INPUT_MAX_CHARS);

    // Assert
    expect(actualMessages[0]).toBe('y'.repeat(prefixLength));
    expect(actualMessages[1].startsWith('&amp;')).toBe(true);
    expect(actualMessages.join('')).toBe(inputLine);
    for (const message of actualMessages) {
      expect(hasBrokenEntity(message)).toBe(false);
    }
  });

  it('keeps an entity that ends exactly at the limit in the first part', () => {
    // Arrange
    const prefixLength = INPUT_MAX_CHARS - '&lt;'.length;
    const inputLine = `${'w'.repeat(prefixLength)}&lt;${'w'.repeat(INPUT_MAX_CHARS)}`;

    // Act
    const actualMessages = splitMessages([inputLine], INPUT_MAX_CHARS);

    // Assert
    expect(actualMessages[0]).toBe(`${'w'.repeat(prefixLength)}&lt;`);
  });

  it('returns no messages for no blocks', () => {
    // Act
    const actualMessages = splitMessages([], INPUT_MAX_CHARS);

    // Assert
    expect(actualMessages).toEqual([]);
  });

  it('property: no message exceeds the limit, no entity is split, all content is kept in order', () => {
    const random = createRandom(42);
    for (let run = 0; run < PROPERTY_RUNS; run++) {
      // Arrange
      const inputMaxChars = PROPERTY_MAX_CHARS_FLOOR + random(PROPERTY_MAX_CHARS_SPAN);
      const inputBlocks = Array.from({ length: 1 + random(PROPERTY_MAX_BLOCKS) }, () =>
        Array.from({ length: 1 + random(PROPERTY_MAX_LINES) }, () =>
          Array.from(
            { length: 1 + random(PROPERTY_MAX_LINE_CHARS) },
            () => ALPHABET[random(ALPHABET.length)],
          ).join(''),
        ).join('\n'),
      );

      // Act
      const actualMessages = splitMessages(inputBlocks, inputMaxChars);

      // Assert
      for (const message of actualMessages) {
        expect(message.length).toBeLessThanOrEqual(inputMaxChars);
        expect(hasBrokenEntity(message)).toBe(false);
      }
      expect(withoutWhitespace(actualMessages.join(''))).toBe(
        withoutWhitespace(inputBlocks.join('')),
      );
    }
  });
});
