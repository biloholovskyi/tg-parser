const ELLIPSIS = '…';

/** Cuts text to `maxChars`, at the last word boundary when there is one, marking the cut. */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  const cut = text.slice(0, maxChars - ELLIPSIS.length);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}${ELLIPSIS}`;
}

/**
 * Splits items into consecutive batches whose summed size stays within `budget`.
 * An item larger than the budget travels alone; order is preserved and nothing is dropped.
 */
export function batchBySize<T>(
  items: readonly T[],
  sizeOf: (item: T) => number,
  budget: number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentSize = 0;
  for (const item of items) {
    const size = sizeOf(item);
    if (current.length > 0 && currentSize + size > budget) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(item);
    currentSize += size;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}
