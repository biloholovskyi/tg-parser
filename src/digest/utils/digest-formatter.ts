import { BOT_MESSAGE_MAX_CHARS, DIGEST_LINKS_PER_LINE, DIGEST_WINDOW_HOURS } from '../constants';
import type { DigestReport } from '../interfaces/digest-run.interface';
import type { DigestTopic, TranslatedPost } from '../interfaces/digest-topic.interface';
import { escapeHtml, postLink } from './html';
import { splitMessages } from './message-splitter';

const LINK_SEPARATOR = ' · ';
const LIST_SEPARATOR = ', ';

/** Renders a run into Telegram HTML messages, each within BOT_MESSAGE_MAX_CHARS. Pure. */
export function formatDigest(report: DigestReport): string[] {
  const byRef = new Map(report.posts.map((post) => [post.ref, post]));
  const mediaOnly = report.posts.filter((post) => !post.hasText);
  const blocks = [
    headerBlock(report),
    ...report.topics.map((topic) => topicBlock(topic, byRef)),
    ...(mediaOnly.length > 0 ? [mediaOnlyBlock(mediaOnly)] : []),
    footerBlock(report),
  ];
  return splitMessages(blocks, BOT_MESSAGE_MAX_CHARS);
}

/** A short message for a run that could not produce a digest. */
export function formatFailure(reason: string): string {
  return `<b>Дайджест не собран</b>\n${escapeHtml(reason)}`;
}

function headerBlock(report: DigestReport): string {
  const date = new Intl.DateTimeFormat('ru-RU', {
    timeZone: report.timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(report.runAt);
  const title = `<b>Дайджест за ${date}</b>`;
  if (report.posts.length === 0) {
    return `${title}\nЗа последние ${DIGEST_WINDOW_HOURS} ч. новых постов нет.`;
  }
  return `${title}\nПостов: ${report.posts.length}, каналов: ${report.collected.channelCount}`;
}

function topicBlock(topic: DigestTopic, byRef: Map<string, TranslatedPost>): string {
  const lines = [`• ${escapeHtml(topic.thesis)}`];
  for (const { source, claim } of topic.viewpoints) {
    lines.push(`  – ${escapeHtml(source)}: ${escapeHtml(claim)}`);
  }
  const links = topic.refs
    .map((ref) => byRef.get(ref))
    .filter((post): post is TranslatedPost => post !== undefined)
    .map((post) => postLink(post.url, post.channel));
  return [...lines, ...linkLines(links)].join('\n');
}

function mediaOnlyBlock(posts: TranslatedPost[]): string {
  const links = posts.map((post) => postLink(post.url, post.channel));
  return ['<b>Посты без текста</b>', ...linkLines(links)].join('\n');
}

function linkLines(links: string[]): string[] {
  const lines: string[] = [];
  for (let start = 0; start < links.length; start += DIGEST_LINKS_PER_LINE) {
    lines.push(links.slice(start, start + DIGEST_LINKS_PER_LINE).join(LINK_SEPARATOR));
  }
  return lines;
}

function footerBlock(report: DigestReport): string {
  const counted = countCovered(report);
  const { unavailableChannels, truncatedChannels } = report.collected;
  const lines = [`Учтено ${counted} из ${report.posts.length} постов`];
  addLine(
    lines,
    unavailableChannels.length > 0,
    `Недоступны каналы: ${channelList(unavailableChannels)}`,
  );
  addLine(
    lines,
    truncatedChannels.length > 0,
    `Прочитаны не полностью, слишком много постов: ${channelList(truncatedChannels)}`,
  );
  addLine(lines, report.skippedPostCount > 0, `Не вошло сверх лимита: ${report.skippedPostCount}`);
  addLine(lines, report.untranslatedCount > 0, `Без перевода: ${report.untranslatedCount}`);
  addLine(
    lines,
    report.fallbackTopicCount > 0,
    `Блоков без группировки: ${report.fallbackTopicCount}`,
  );
  addLine(lines, report.isSummaryFallback, 'Саммари не собрано, посты перечислены списком');
  // Tags per line: a split between lines must never leave a tag open.
  return lines.map((line) => `<i>${line}</i>`).join('\n');
}

/** Posts that appear in the message: referenced by a topic, or listed as media-only. */
function countCovered(report: DigestReport): number {
  const covered = new Set(report.topics.flatMap((topic) => topic.refs));
  return report.posts.filter((post) => !post.hasText || covered.has(post.ref)).length;
}

function channelList(channels: string[]): string {
  return escapeHtml(channels.map((channel) => `@${channel}`).join(LIST_SEPARATOR));
}

function addLine(lines: string[], isShown: boolean, line: string): void {
  if (isShown) {
    lines.push(line);
  }
}
