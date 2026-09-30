const BLOCK_SEPARATOR = '\n\n';
const LINE_SEPARATOR = '\n';

/**
 * Packs blocks into messages of at most `maxChars`, cutting only between blocks. A block longer
 * than the limit is cut between lines, and a single line longer than the limit is cut by
 * characters without splitting an HTML entity. Nothing is dropped and order is kept.
 */
export function splitMessages(blocks: readonly string[], maxChars: number): string[] {
  const pieces = blocks.flatMap((block) =>
    block.length <= maxChars ? [block] : splitBlock(block, maxChars),
  );
  return pack(pieces, maxChars, BLOCK_SEPARATOR);
}

function splitBlock(block: string, maxChars: number): string[] {
  const lines = block
    .split(LINE_SEPARATOR)
    .flatMap((line) => (line.length <= maxChars ? [line] : cutLine(line, maxChars)));
  return pack(lines, maxChars, LINE_SEPARATOR);
}

function pack(pieces: readonly string[], maxChars: number, separator: string): string[] {
  const messages: string[] = [];
  let current = '';
  for (const piece of pieces) {
    const candidate = current ? `${current}${separator}${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    messages.push(current);
    current = piece;
  }
  if (current) {
    messages.push(current);
  }
  return messages;
}

/** Cuts a plain line by characters; a cut never lands inside `&amp;`-style entities. */
function cutLine(line: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > maxChars) {
    let end = maxChars;
    const entityStart = rest.lastIndexOf('&', end - 1);
    if (entityStart > 0 && !rest.slice(entityStart, end).includes(';')) {
      end = entityStart;
    }
    parts.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  return [...parts, rest];
}
