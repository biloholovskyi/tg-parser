import {
  COVERAGE_SCHEMA,
  SUMMARY_SCHEMA,
  TRANSLATION_SCHEMA,
  isCoverageAnswer,
  isSummaryAnswer,
  isTranslationAnswer,
} from './schemas';

const validTopic = {
  thesis: 'fake thesis',
  viewpoints: [{ source: 'a', claim: 'b' }],
  refs: ['p1'],
};

describe('Grok answer schemas', () => {
  it.each([
    ['translation', TRANSLATION_SCHEMA, ['translations']],
    ['summary', SUMMARY_SCHEMA, ['topics']],
    ['coverage', COVERAGE_SCHEMA, ['additions', 'newTopics']],
  ])(
    '%s schema is a strict object requiring every property',
    (_name, inputSchema, expectedRequired) => {
      // Assert
      expect(inputSchema.type).toBe('object');
      expect(inputSchema.additionalProperties).toBe(false);
      expect(inputSchema.required).toEqual(expectedRequired);
    },
  );
});

describe('isTranslationAnswer', () => {
  it('accepts a list of ref and text pairs, including an empty list', () => {
    // Assert
    expect(isTranslationAnswer({ translations: [{ ref: 'p1', text: 'fake' }] })).toBe(true);
    expect(isTranslationAnswer({ translations: [] })).toBe(true);
  });

  it.each([
    null,
    'text',
    {},
    { translations: 'nope' },
    { translations: [{ ref: 'p1' }] },
    { translations: [{ ref: 1, text: 'fake' }] },
    { translations: [null] },
  ])('rejects %p', (inputValue) => {
    // Assert
    expect(isTranslationAnswer(inputValue)).toBe(false);
  });
});

describe('isSummaryAnswer', () => {
  it('accepts topics with thesis, viewpoints and refs', () => {
    // Assert
    expect(isSummaryAnswer({ topics: [validTopic] })).toBe(true);
    expect(isSummaryAnswer({ topics: [] })).toBe(true);
  });

  it.each([
    undefined,
    { topics: null },
    { topics: [{ ...validTopic, thesis: 1 }] },
    { topics: [{ ...validTopic, refs: [1] }] },
    { topics: [{ ...validTopic, refs: 'p1' }] },
    { topics: [{ ...validTopic, viewpoints: [{ source: 'a' }] }] },
    { topics: [{ ...validTopic, viewpoints: null }] },
  ])('rejects %p', (inputValue) => {
    // Assert
    expect(isSummaryAnswer(inputValue)).toBe(false);
  });
});

describe('isCoverageAnswer', () => {
  it('accepts additions by integer topic number and new topics', () => {
    // Assert
    expect(
      isCoverageAnswer({ additions: [{ topicNumber: 2, refs: ['p1'] }], newTopics: [validTopic] }),
    ).toBe(true);
    expect(isCoverageAnswer({ additions: [], newTopics: [] })).toBe(true);
  });

  it.each([
    {},
    { additions: [] },
    { newTopics: [] },
    { additions: [{ topicNumber: 1.5, refs: [] }], newTopics: [] },
    { additions: [{ topicNumber: '1', refs: [] }], newTopics: [] },
    { additions: [{ topicNumber: 1, refs: [2] }], newTopics: [] },
    { additions: [], newTopics: [{ thesis: 'x' }] },
  ])('rejects %p', (inputValue) => {
    // Assert
    expect(isCoverageAnswer(inputValue)).toBe(false);
  });
});
