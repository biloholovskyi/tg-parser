import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AuthResponseDto, CompleteAuthDto } from './dto/auth.dto';
import { GetPostsResponse } from './interfaces/message.interface';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * POST /telegram/auth
   * Авторизация пользователя через Telegram
   *
   * Этапы:
   * 1. Отправить phoneNumber - получишь needsCode: true
   * 2. Отправить phoneNumber + phoneCode - получишь sessionString или needsPassword: true
   * 3. Если нужен пароль, отправь phoneNumber + phoneCode + password
   */
  @Post('auth')
  @HttpCode(HttpStatus.OK)
  async authenticate(@Body() authDto: CompleteAuthDto): Promise<AuthResponseDto> {
    const { phoneNumber, phoneCode, password } = authDto;

    if (!phoneNumber) {
      return {
        message: 'phoneNumber is required',
      };
    }

    return await this.telegramService.authenticate(phoneNumber, phoneCode, password);
  }

  /**
   * GET /telegram/me
   * Проверяет валидность сессии — всегда 200, status: success | failed
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async checkSession(
    @Query('sessionString') sessionString?: string,
  ): Promise<{ status: 'success' | 'failed' }> {
    if (!sessionString) {
      return { status: 'failed' };
    }
    const fixedSessionString = sessionString.replace(/ /g, '+');
    return await this.telegramService.checkSession(fixedSessionString);
  }

  /**
   * GET /telegram/channel/:channelUsername/posts
   * Получает посты канала за указанный период
   *
   * Query params:
   * - sessionString: строка сессии из /auth
   * - hoursBack: количество часов назад (по умолчанию 24, максимум 720)
   */
  @Get('channel/:channelUsername/posts')
  async getChannelPosts(
    @Param('channelUsername') channelUsername: string,
    @Query('sessionString') sessionString?: string,
    @Query('hoursBack') hoursBack?: string,
  ): Promise<GetPostsResponse> {
    if (!sessionString) {
      throw new BadRequestException('sessionString query parameter is required');
    }

    // Fix URL encoding: replace spaces back to + (spaces are decoded + in URL)
    const fixedSessionString = sessionString.replace(/ /g, '+');

    // Парсим hoursBack или используем значение по умолчанию
    const hours = hoursBack ? parseInt(hoursBack, 10) : 24;

    // Валидация
    if (isNaN(hours) || hours < 1 || hours > 720) {
      throw new BadRequestException('hoursBack must be a number between 1 and 720');
    }

    return await this.telegramService.getChannelPosts(channelUsername, fixedSessionString, hours);
  }
}
