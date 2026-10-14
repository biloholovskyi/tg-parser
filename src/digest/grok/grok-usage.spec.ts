import { GrokUsageMeter, readGrokUsage } from './grok-usage';

const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0 };

describe('GrokUsageMeter', () => {
  it('starts at zero and describes zero counts', () => {
    // Act
    const actualMeter = new GrokUsageMeter();

    // Assert
    expect(actualMeter.usage).toEqual(ZERO_USAGE);
    expect(actualMeter.describe()).toBe('tokens in=0 out=0 reasoning=0');
  });

  it('sums every added usage field by field', () => {
    // Arrange
    const actualMeter = new GrokUsageMeter();

    // Act
    actualMeter.add({ promptTokens: 100, completionTokens: 20, reasoningTokens: 5 });
    actualMeter.add({ promptTokens: 50, completionTokens: 0, reasoningTokens: 7 });
    actualMeter.add(ZERO_USAGE);

    // Assert
    expect(actualMeter.usage).toEqual({
      promptTokens: 150,
      completionTokens: 20,
      reasoningTokens: 12,
    });
    expect(actualMeter.describe()).toBe('tokens in=150 out=20 reasoning=12');
  });

  it('returns a copy of the totals that cannot change the meter', () => {
    // Arrange
    const actualMeter = new GrokUsageMeter();
    actualMeter.add({ promptTokens: 3, completionTokens: 2, reasoningTokens: 1 });

    // Act
    const actualSnapshot = actualMeter.usage;
    actualSnapshot.promptTokens = 999;

    // Assert
    expect(actualMeter.usage.promptTokens).toBe(3);
  });

  it('keeps separate meters independent', () => {
    // Arrange
    const actualFirst = new GrokUsageMeter();
    const actualSecond = new GrokUsageMeter();

    // Act
    actualFirst.add({ promptTokens: 4, completionTokens: 4, reasoningTokens: 4 });

    // Assert
    expect(actualSecond.usage).toEqual(ZERO_USAGE);
  });
});

describe('readGrokUsage', () => {
  it('reads prompt, completion and reasoning tokens', () => {
    // Arrange
    const inputBody = {
      choices: [],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 340,
        total_tokens: 1540,
        completion_tokens_details: { reasoning_tokens: 90 },
      },
    };

    // Act
    const actualUsage = readGrokUsage(inputBody);

    // Assert
    expect(actualUsage).toEqual({
      promptTokens: 1200,
      completionTokens: 340,
      reasoningTokens: 90,
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'not a body'],
    ['a number', 42],
    ['a body without usage', { choices: [] }],
    ['a null usage', { usage: null }],
    ['an empty usage', { usage: {} }],
  ])('returns zeros for %s', (_label, inputBody) => {
    // Act
    const actualUsage = readGrokUsage(inputBody);

    // Assert
    expect(actualUsage).toEqual(ZERO_USAGE);
  });

  it('reads zero reasoning tokens when completion_tokens_details is missing', () => {
    // Act
    const actualUsage = readGrokUsage({ usage: { prompt_tokens: 7, completion_tokens: 3 } });

    // Assert
    expect(actualUsage).toEqual({ promptTokens: 7, completionTokens: 3, reasoningTokens: 0 });
  });

  it.each([
    ['a negative number', -5],
    ['a numeric string', '12'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
    ['an object', { value: 3 }],
    ['a boolean', true],
  ])('counts %s as zero in every field', (_label, inputValue) => {
    // Arrange
    const inputBody = {
      usage: {
        prompt_tokens: inputValue,
        completion_tokens: inputValue,
        completion_tokens_details: { reasoning_tokens: inputValue },
      },
    };

    // Act
    const actualUsage = readGrokUsage(inputBody);

    // Assert
    expect(actualUsage).toEqual(ZERO_USAGE);
  });

  it('keeps valid fields when only one field is malformed', () => {
    // Act
    const actualUsage = readGrokUsage({
      usage: {
        prompt_tokens: 10,
        completion_tokens: -1,
        completion_tokens_details: 'broken',
      },
    });

    // Assert
    expect(actualUsage).toEqual({ promptTokens: 10, completionTokens: 0, reasoningTokens: 0 });
  });
});
