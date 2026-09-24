import type { Api } from 'telegram/tl';
import { MS_IN_SECOND } from '../../shared/constants/rate-limit.constants';
import { POST_URL_BASE } from '../constants';
import type { TelegramMedia, TelegramPost } from '../interfaces/message.interface';

/** Converts an MTProto message into the response shape. Pure: no state, no network. */
export function toTelegramPost(message: Api.Message, channelUsername: string): TelegramPost {
  return {
    id: message.id,
    text: message.message || '',
    date: new Date(message.date * MS_IN_SECOND),
    media: mediaOf(message),
    postUrl: `${POST_URL_BASE}/${channelUsername}/${message.id}`,
  };
}

function mediaOf(message: Api.Message): TelegramMedia[] {
  if (!message.media) {
    return [];
  }
  if (message.photo) {
    return [{ type: 'photo' }];
  }
  if (message.video) {
    return [{ type: 'video' }];
  }
  if (message.document) {
    return [{ type: 'document' }];
  }
  return [];
}
