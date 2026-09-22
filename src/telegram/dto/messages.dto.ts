import { IsNotEmpty, IsOptional, IsNumber, IsString, Max, Min } from 'class-validator';

export const HOURS_BACK_MIN = 1;
export const HOURS_BACK_MAX = 720; // 30 дней
export const HOURS_BACK_DEFAULT = 24;

export class GetPostsDto {
  @IsString()
  @IsNotEmpty()
  sessionString: string;

  @IsOptional()
  @IsNumber()
  @Min(HOURS_BACK_MIN)
  @Max(HOURS_BACK_MAX)
  hoursBack?: number = HOURS_BACK_DEFAULT;
}
