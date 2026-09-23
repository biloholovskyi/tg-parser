import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export const HOURS_BACK_MIN = 1;
export const HOURS_BACK_MAX = 720; // 30 дней
export const HOURS_BACK_DEFAULT = 24;

export const CHANNEL_USERNAME_MIN_LENGTH = 5;
export const CHANNEL_USERNAME_MAX_LENGTH = 32;

const FIRST_CHARACTER_LENGTH = 1;
const CHANNEL_USERNAME_PATTERN = new RegExp(
  `^@?[a-zA-Z][a-zA-Z0-9_]{${CHANNEL_USERNAME_MIN_LENGTH - FIRST_CHARACTER_LENGTH},${
    CHANNEL_USERNAME_MAX_LENGTH - FIRST_CHARACTER_LENGTH
  }}$`,
);

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
