/** Escapes text for Telegram's HTML parse mode, which recognizes only these three characters. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A link to a post, labelled `@channel/id`. */
export function postLink(url: string, channel: string): string {
  const postId = url.slice(url.lastIndexOf('/') + 1);
  return `<a href="${escapeHtml(url).replace(/"/g, '&quot;')}">@${escapeHtml(channel)}/${escapeHtml(postId)}</a>`;
}
