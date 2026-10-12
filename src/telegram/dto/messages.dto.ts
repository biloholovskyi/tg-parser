import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { CHANNEL_USERNAME_PATTERN } from '../../shared/constants/channel-username.constants';

export {
  CHANNEL_USERNAME_MAX_LENGTH,
  CHANNEL_USERNAME_MIN_LENGTH,
} from '../../shared/constants/channel-username.constants';

export const HOURS_BACK_MIN = 1;
export const HOURS_BACK_MAX = 720; // 30 дней
export const HOURS_BACK_DEFAULT = 24;

/** Validated before any MTProto call, so a malformed name never reaches Telegram. */
export class ChannelPostsParamsDto {
  @Matches(CHANNEL_USERNAME_PATTERN, {
    message: 'channelUsername must be a valid Telegram username',
  })
  channelUsername: string;
}

export class GetPostsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(HOURS_BACK_MIN)
  @Max(HOURS_BACK_MAX)
  hoursBack?: number = HOURS_BACK_DEFAULT;
}
