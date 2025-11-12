import { IsOptional, IsNumber, Min, Max } from 'class-validator';

export class GetPostsDto {
  sessionString: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(720) // Максимум 30 дней
  hoursBack?: number = 24;
}

