import type { Api } from 'telegram/tl';
import { MS_IN_SECOND } from '../../shared/constants/rate-limit.constants';
import { POST_URL_BASE } from '../constants';
import { toTelegramPost } from './message.mapper';

interface FakeMessageFields {
  id: number;
  date: number;
  message?: string;
  media?: unknown;
  photo?: unknown;
  video?: unknown;
  document?: unknown;
}

const inputChannel = 'fake_channel';
const INPUT_MESSAGE_ID = 4242;
/** 2023-11-14T22:13:20Z in seconds, as MTProto dates are. */
const INPUT_DATE_S = 1_700_000_000;

function buildMessage(fields: Partial<FakeMessageFields> = {}): Api.Message {
  const message: FakeMessageFields = { id: INPUT_MESSAGE_ID, date: INPUT_DATE_S, ...fields };
  return message as unknown as Api.Message;
}

describe('toTelegramPost', () => {
  it('maps id, text, date and the public post URL', () => {
    // Arrange
    const inputMessage = buildMessage({ message: 'fake post text' });

    // Act
    const actualPost = toTelegramPost(inputMessage, inputChannel);

    // Assert
    expect(actualPost).toEqual({
      id: INPUT_MESSAGE_ID,
      text: 'fake post text',
      date: new Date(INPUT_DATE_S * MS_IN_SECOND),
      media: [],
      postUrl: `${POST_URL_BASE}/${inputChannel}/${INPUT_MESSAGE_ID}`,
    });
  });

  it('converts the MTProto date from seconds to a Date', () => {
    // Act
    const actualPost = toTelegramPost(buildMessage(), inputChannel);

    // Assert
    expect(actualPost.date).toBeInstanceOf(Date);
    expect(actualPost.date.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
  ])('falls back to an empty string when the text is %s', (_label, inputText) => {
    // Act
    const actualPost = toTelegramPost(buildMessage({ message: inputText }), inputChannel);

    // Assert
    expect(actualPost.text).toBe('');
  });

  it('builds the post URL from the channel username passed in', () => {
    // Act
    const actualPost = toTelegramPost(buildMessage(), 'another_fake_channel');

    // Assert
    expect(actualPost.postUrl).toBe(`${POST_URL_BASE}/another_fake_channel/${INPUT_MESSAGE_ID}`);
  });

  it.each([
    ['a photo', { media: { fake: 'media' }, photo: { fake: 'photo' } }, [{ type: 'photo' }]],
    ['a video', { media: { fake: 'media' }, video: { fake: 'video' } }, [{ type: 'video' }]],
    [
      'a document',
      { media: { fake: 'media' }, document: { fake: 'document' } },
      [{ type: 'document' }],
    ],
    [
      'a photo taking precedence over a document',
      { media: { fake: 'media' }, photo: { fake: 'photo' }, document: { fake: 'document' } },
      [{ type: 'photo' }],
    ],
    ['no media', {}, []],
    ['media of an unknown kind', { media: { fake: 'geo' } }, []],
    ['a photo field but no media', { photo: { fake: 'photo' } }, []],
  ])('maps a message with %s', (_label, inputFields, expectedMedia) => {
    // Act
    const actualPost = toTelegramPost(buildMessage(inputFields), inputChannel);

    // Assert
    expect(actualPost.media).toEqual(expectedMedia);
  });

  it('never exposes a media URL', () => {
    // Act
    const actualPost = toTelegramPost(
      buildMessage({ media: { fake: 'media' }, photo: { fake: 'photo' } }),
      inputChannel,
    );

    // Assert
    expect(actualPost.media[0]).not.toHaveProperty('url');
  });
});
