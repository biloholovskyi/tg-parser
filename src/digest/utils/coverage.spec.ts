import type { DigestTopic } from '../interfaces/digest-topic.interface';
import { dropUnknownRefs, findMissingRefs } from './coverage';

function buildTopic(refs: string[], thesis = 'fake thesis'): DigestTopic {
  return { thesis, viewpoints: [], refs, isFallback: false };
}

describe('dropUnknownRefs', () => {
  const inputKnown: ReadonlySet<string> = new Set(['p1', 'p2', 'p3']);

  it('keeps topics whose refs are all known', () => {
    // Arrange
    const inputTopics = [buildTopic(['p1', 'p2']), buildTopic(['p3'])];

    // Act
    const actualTopics = dropUnknownRefs(inputTopics, inputKnown);

    // Assert
    expect(actualTopics).toEqual(inputTopics);
  });

  it('removes invented refs and keeps the rest of the topic', () => {
    // Arrange
    const inputTopics = [
      {
        ...buildTopic(['p1', 'p99', 'p2'], 'kept thesis'),
        viewpoints: [{ source: 's', claim: 'c' }],
      },
    ];

    // Act
    const actualTopics = dropUnknownRefs(inputTopics, inputKnown);

    // Assert
    expect(actualTopics).toEqual([
      {
        thesis: 'kept thesis',
        viewpoints: [{ source: 's', claim: 'c' }],
        refs: ['p1', 'p2'],
        isFallback: false,
      },
    ]);
  });

  it('removes repeats of a ref inside one topic', () => {
    // Arrange
    const inputTopics = [buildTopic(['p1', 'p1', 'p2', 'p1'])];

    // Act
    const actualTopics = dropUnknownRefs(inputTopics, inputKnown);

    // Assert
    expect(actualTopics[0].refs).toEqual(['p1', 'p2']);
  });

  it('keeps a ref that appears in two different topics', () => {
    // Arrange
    const inputTopics = [buildTopic(['p1']), buildTopic(['p1', 'p2'])];

    // Act
    const actualTopics = dropUnknownRefs(inputTopics, inputKnown);

    // Assert
    expect(actualTopics.map((topic) => topic.refs)).toEqual([['p1'], ['p1', 'p2']]);
  });

  it('drops topics left without a known ref, including empty ones', () => {
    // Arrange
    const inputTopics = [buildTopic(['p77', 'p88']), buildTopic([]), buildTopic(['p3'])];

    // Act
    const actualTopics = dropUnknownRefs(inputTopics, inputKnown);

    // Assert
    expect(actualTopics).toEqual([buildTopic(['p3'])]);
  });

  it('does not mutate the input topics', () => {
    // Arrange
    const inputTopics = [buildTopic(['p1', 'p99', 'p1'])];

    // Act
    dropUnknownRefs(inputTopics, inputKnown);

    // Assert
    expect(inputTopics[0].refs).toEqual(['p1', 'p99', 'p1']);
  });
});

describe('findMissingRefs', () => {
  it('returns nothing when every expected ref is covered', () => {
    // Arrange
    const inputTopics = [buildTopic(['p2', 'p1']), buildTopic(['p3'])];

    // Act
    const actualMissing = findMissingRefs(inputTopics, ['p1', 'p2', 'p3']);

    // Assert
    expect(actualMissing).toEqual([]);
  });

  it('returns the uncovered refs in their original order', () => {
    // Arrange
    const inputTopics = [buildTopic(['p3'])];

    // Act
    const actualMissing = findMissingRefs(inputTopics, ['p5', 'p1', 'p3', 'p2']);

    // Assert
    expect(actualMissing).toEqual(['p5', 'p1', 'p2']);
  });

  it('returns every expected ref when there are no topics', () => {
    // Act
    const actualMissing = findMissingRefs([], ['p1', 'p2']);

    // Assert
    expect(actualMissing).toEqual(['p1', 'p2']);
  });

  it('ignores refs in topics that were not expected', () => {
    // Arrange
    const inputTopics = [buildTopic(['p42'])];

    // Act
    const actualMissing = findMissingRefs(inputTopics, ['p1']);

    // Assert
    expect(actualMissing).toEqual(['p1']);
  });
});
