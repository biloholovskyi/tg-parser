import { escapeHtml, postLink } from './html';

describe('escapeHtml', () => {
  it('escapes &, < and > for Telegram HTML parse mode', () => {
    // Arrange
    const inputText = 'a < b && c > d';

    // Act
    const actualText = escapeHtml(inputText);

    // Assert
    expect(actualText).toBe('a &lt; b &amp;&amp; c &gt; d');
  });

  it('escapes & first, so an existing entity is not left unescaped', () => {
    // Act
    const actualText = escapeHtml('&lt;');

    // Assert
    expect(actualText).toBe('&amp;lt;');
  });

  it('leaves text without special characters unchanged, quotes included', () => {
    // Arrange
    const inputText = 'Простой "текст" без тегов';

    // Act
    const actualText = escapeHtml(inputText);

    // Assert
    expect(actualText).toBe(inputText);
  });

  it('turns an injected tag into inert text', () => {
    // Act
    const actualText = escapeHtml('<b>bold</b><a href="x">');

    // Assert
    expect(actualText).not.toMatch(/[<>]/);
  });
});

describe('postLink', () => {
  it('renders an anchor labelled @channel/id pointing at the url', () => {
    // Act
    const actualLink = postLink('https://t.me/fake_channel/63454', 'fake_channel');

    // Assert
    expect(actualLink).toBe('<a href="https://t.me/fake_channel/63454">@fake_channel/63454</a>');
  });

  it('escapes quotes and ampersands inside href so the attribute cannot be broken', () => {
    // Arrange
    const inputUrl = 'https://t.me/x?a=1&b="2"/7';

    // Act
    const actualLink = postLink(inputUrl, 'fake');

    // Assert
    expect(actualLink).toBe('<a href="https://t.me/x?a=1&amp;b=&quot;2&quot;/7">@fake/7</a>');
  });

  it('escapes the channel and post id in the label', () => {
    // Act
    const actualLink = postLink('https://t.me/fake/<1>', 'a<b');

    // Assert
    expect(actualLink).toContain('>@a&lt;b/&lt;1&gt;</a>');
  });
});
