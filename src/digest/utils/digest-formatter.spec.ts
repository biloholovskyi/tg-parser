import { BOT_MESSAGE_MAX_CHARS, DIGEST_LINKS_PER_LINE, DIGEST_WINDOW_HOURS } from '../constants';
import type { DigestReport } from '../interfaces/digest-run.interface';
import type { DigestTopic, TranslatedPost } from '../interfaces/digest-topic.interface';
import { formatDigest, formatFailure } from './digest-formatter';

/** 22:30 UTC on 10.03.2026 is already 11.03.2026 in Kyiv (UTC+2 before the DST switch). */
const INPUT_RUN_AT = new Date(Date.UTC(2026, 2, 10, 22, 30));
const INPUT_TIMEZONE = 'Europe/Kyiv';
const BIG_POST_COUNT = 600;
const BIG_TOPIC_COUNT = 150;
const BIG_THESIS_REPEAT = 40;
const LONG_THESIS_REPEAT = 1200;

function buildPost(index: number, hasText = true, channel = 'fake_channel'): TranslatedPost {
  return {
    ref: `p${index}`,
    channel,
    url: `https://t.me/${channel}/${index}`,
    text: hasText ? `fake original ${index}` : '',
    translated: hasText ? `фейковый перевод ${index}` : '',
    date: new Date(INPUT_RUN_AT.getTime() - index),
    hasText,
    isUntranslated: false,
  };
}

function buildTopic(refs: string[], thesis = 'Тезис', viewpoints: DigestTopic['viewpoints'] = []) {
  return { thesis, viewpoints, refs, isFallback: false };
}

function buildReport(overrides: Partial<DigestReport> = {}): DigestReport {
  const posts = overrides.posts ?? [buildPost(1), buildPost(2)];
  return {
    runAt: INPUT_RUN_AT,
    timezone: INPUT_TIMEZONE,
    collected: {
      posts,
      channelCount: 1,
      unavailableChannels: [],
      truncatedChannels: [],
    },
    posts,
    topics: [buildTopic(posts.filter((post) => post.hasText).map((post) => post.ref))],
    skippedPostCount: 0,
    untranslatedCount: 0,
    fallbackTopicCount: 0,
    isSummaryFallback: false,
    ...overrides,
  };
}

function countOf(text: string, token: string): number {
  return text.split(token).length - 1;
}

function footerLines(messages: string[]): string[] {
  return messages
    .join('\n')
    .split('\n')
    .filter((line) => line.startsWith('<i>'));
}

describe('formatDigest', () => {
  describe('header', () => {
    it('shows the date in the report time zone and the post and channel counts', () => {
      // Arrange
      const inputPosts = [buildPost(1), buildPost(2), buildPost(3)];
      const inputReport = buildReport({
        posts: inputPosts,
        collected: {
          posts: inputPosts,
          channelCount: 2,
          unavailableChannels: [],
          truncatedChannels: [],
        },
      });

      // Act
      const [actualFirst] = formatDigest(inputReport);

      // Assert
      expect(actualFirst.startsWith('<b>Дайджест за 11.03.2026</b>\nПостов: 3, каналов: 2')).toBe(
        true,
      );
    });

    it('renders the date of another time zone when the report says so', () => {
      // Act
      const [actualFirst] = formatDigest(buildReport({ timezone: 'UTC' }));

      // Assert
      expect(actualFirst).toContain('Дайджест за 10.03.2026');
    });

    it('sends one short message saying there were no posts for an empty day', () => {
      // Arrange
      const inputReport = buildReport({ posts: [], topics: [] });

      // Act
      const actualMessages = formatDigest(inputReport);

      // Assert
      expect(actualMessages).toEqual([
        `<b>Дайджест за 11.03.2026</b>\nЗа последние ${DIGEST_WINDOW_HOURS} ч. новых постов нет.` +
          '\n\n<i>Учтено 0 из 0 постов</i>',
      ]);
    });
  });

  describe('topic blocks', () => {
    it('escapes <, > and & in theses, viewpoints and sources', () => {
      // Arrange
      const inputReport = buildReport({
        topics: [
          buildTopic(['p1', 'p2'], 'A <b>&</b> B', [{ source: '<src>', claim: 'x > y & z' }]),
        ],
      });

      // Act
      const actualText = formatDigest(inputReport).join('\n');

      // Assert
      expect(actualText).toContain('• A &lt;b&gt;&amp;&lt;/b&gt; B');
      expect(actualText).toContain('  – &lt;src&gt;: x &gt; y &amp; z');
      expect(actualText).not.toContain('<b>&</b>');
      expect(actualText).not.toContain('<src>');
    });

    it('lists viewpoints under the thesis, one line each, before the links', () => {
      // Arrange
      const inputReport = buildReport({
        topics: [
          buildTopic(['p1'], 'Тезис', [
            { source: 'канал А', claim: 'утверждение один' },
            { source: 'канал Б', claim: 'утверждение два' },
          ]),
        ],
      });

      // Act
      const actualText = formatDigest(inputReport).join('\n');

      // Assert
      expect(actualText).toContain(
        '• Тезис\n  – канал А: утверждение один\n  – канал Б: утверждение два\n' +
          '<a href="https://t.me/fake_channel/1">@fake_channel/1</a>',
      );
    });

    it('wraps links after DIGEST_LINKS_PER_LINE per line', () => {
      // Arrange
      const inputPosts = Array.from({ length: DIGEST_LINKS_PER_LINE + 1 }, (_, index) =>
        buildPost(index + 1),
      );
      const inputReport = buildReport({
        posts: inputPosts,
        topics: [
          buildTopic(
            inputPosts.map((post) => post.ref),
            'Тезис',
          ),
        ],
      });

      // Act
      const actualLines = formatDigest(inputReport).join('\n').split('\n');

      // Assert
      const linkLines = actualLines.filter((line) => line.startsWith('<a '));
      expect(linkLines).toHaveLength(2);
      expect(countOf(linkLines[0], '<a ')).toBe(DIGEST_LINKS_PER_LINE);
      expect(countOf(linkLines[0], ' · ')).toBe(DIGEST_LINKS_PER_LINE - 1);
      expect(countOf(linkLines[1], '<a ')).toBe(1);
    });

    it('drops a topic ref that matches no post instead of printing a broken link', () => {
      // Arrange
      const inputReport = buildReport({ topics: [buildTopic(['p1', 'p404'], 'Тезис')] });

      // Act
      const actualText = formatDigest(inputReport).join('\n');

      // Assert
      expect(countOf(actualText, '<a ')).toBe(1);
      expect(actualText).not.toContain('p404');
    });
  });

  describe('media-only block', () => {
    it('lists posts without text under their own heading and counts them as covered', () => {
      // Arrange
      const inputPosts = [buildPost(1), buildPost(2, false), buildPost(3, false)];
      const inputReport = buildReport({ posts: inputPosts, topics: [buildTopic(['p1'])] });

      // Act
      const actualText = formatDigest(inputReport).join('\n');

      // Assert
      expect(actualText).toContain(
        '<b>Посты без текста</b>\n<a href="https://t.me/fake_channel/2">@fake_channel/2</a>' +
          ' · <a href="https://t.me/fake_channel/3">@fake_channel/3</a>',
      );
      expect(actualText).toContain('<i>Учтено 3 из 3 постов</i>');
    });

    it('has no media-only block when every post has text', () => {
      // Act
      const actualText = formatDigest(buildReport()).join('\n');

      // Assert
      expect(actualText).not.toContain('Посты без текста');
    });
  });

  describe('footer', () => {
    it('shows only the count line when nothing went wrong', () => {
      // Act
      const actualFooter = footerLines(formatDigest(buildReport()));

      // Assert
      expect(actualFooter).toEqual(['<i>Учтено 2 из 2 постов</i>']);
    });

    it('counts a text post no topic references as not covered', () => {
      // Arrange
      const inputPosts = [buildPost(1), buildPost(2), buildPost(3)];
      const inputReport = buildReport({ posts: inputPosts, topics: [buildTopic(['p1', 'p3'])] });

      // Act
      const actualFooter = footerLines(formatDigest(inputReport));

      // Assert
      expect(actualFooter[0]).toBe('<i>Учтено 2 из 3 постов</i>');
    });

    it('lists every problem on its own italic line, channels escaped', () => {
      // Arrange
      const inputReport = buildReport({
        collected: {
          posts: [],
          channelCount: 4,
          unavailableChannels: ['fake_gone', 'fake_<closed>'],
          truncatedChannels: ['fake_busy'],
        },
        skippedPostCount: 7,
        untranslatedCount: 3,
        fallbackTopicCount: 2,
        isSummaryFallback: true,
      });

      // Act
      const actualFooter = footerLines(formatDigest(inputReport));

      // Assert
      expect(actualFooter).toEqual([
        '<i>Учтено 2 из 2 постов</i>',
        '<i>Недоступны каналы: @fake_gone, @fake_&lt;closed&gt;</i>',
        '<i>Прочитаны не полностью, слишком много постов: @fake_busy</i>',
        '<i>Не вошло сверх лимита: 7</i>',
        '<i>Без перевода: 3</i>',
        '<i>Блоков без группировки: 2</i>',
        '<i>Саммари не собрано, посты перечислены списком</i>',
      ]);
    });

    it('shows the summary-fallback line alone when only the summary failed', () => {
      // Act
      const actualFooter = footerLines(formatDigest(buildReport({ isSummaryFallback: true })));

      // Assert
      expect(actualFooter).toEqual([
        '<i>Учтено 2 из 2 постов</i>',
        '<i>Саммари не собрано, посты перечислены списком</i>',
      ]);
    });
  });

  describe('splitting', () => {
    function buildBigReport(): DigestReport {
      const posts = Array.from({ length: BIG_POST_COUNT }, (_, index) =>
        buildPost(index + 1, index % 10 !== 0, `fake_channel_${index % 7}`),
      );
      const textRefs = posts.filter((post) => post.hasText).map((post) => post.ref);
      const refsPerTopic = Math.ceil(textRefs.length / BIG_TOPIC_COUNT);
      const topics = Array.from({ length: BIG_TOPIC_COUNT }, (_, index) =>
        buildTopic(
          textRefs.slice(index * refsPerTopic, (index + 1) * refsPerTopic),
          `Тезис ${index} & <подробности> `.repeat(BIG_THESIS_REPEAT),
          [{ source: `канал ${index}`, claim: 'утверждение & ещё' }],
        ),
      );
      return buildReport({
        posts,
        topics,
        collected: {
          posts,
          channelCount: 7,
          unavailableChannels: ['fake_gone'],
          truncatedChannels: ['fake_busy'],
        },
      });
    }

    it('keeps every message of a large report within BOT_MESSAGE_MAX_CHARS', () => {
      // Act
      const actualMessages = formatDigest(buildBigReport());

      // Assert
      expect(actualMessages.length).toBeGreaterThan(1);
      for (const message of actualMessages) {
        expect(message.length).toBeLessThanOrEqual(BOT_MESSAGE_MAX_CHARS);
      }
    });

    it('leaves no tag open across a message boundary', () => {
      // Act
      const actualMessages = formatDigest(buildBigReport());

      // Assert
      for (const message of actualMessages) {
        expect(countOf(message, '<a ')).toBe(countOf(message, '</a>'));
        expect(countOf(message, '<b>')).toBe(countOf(message, '</b>'));
        expect(countOf(message, '<i>')).toBe(countOf(message, '</i>'));
      }
    });

    it('prints every post link once and reports N of N covered', () => {
      // Arrange
      const inputReport = buildBigReport();

      // Act
      const actualText = formatDigest(inputReport).join('\n');

      // Assert
      expect(countOf(actualText, '<a ')).toBe(BIG_POST_COUNT);
      expect(actualText).toContain(`<i>Учтено ${BIG_POST_COUNT} из ${BIG_POST_COUNT} постов</i>`);
    });

    it('cuts a single thesis longer than one message without exceeding the limit', () => {
      // Arrange
      const inputReport = buildReport({
        topics: [buildTopic(['p1', 'p2'], 'длинно & долго '.repeat(LONG_THESIS_REPEAT))],
      });

      // Act
      const actualMessages = formatDigest(inputReport);

      // Assert
      expect(actualMessages.length).toBeGreaterThan(1);
      for (const message of actualMessages) {
        expect(message.length).toBeLessThanOrEqual(BOT_MESSAGE_MAX_CHARS);
      }
    });
  });
});

describe('formatFailure', () => {
  it('renders a bold title and the escaped reason', () => {
    // Act
    const actualMessage = formatFailure('Сессия <x> & отозвана');

    // Assert
    expect(actualMessage).toBe('<b>Дайджест не собран</b>\nСессия &lt;x&gt; &amp; отозвана');
  });
});
