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
import { PhoneRateLimited } from '../shared/decorators/phone-rate-limited.decorator';
import { PublicRoute } from '../shared/decorators/public-route.decorator';
import { SessionString } from '../shared/decorators/session-string.decorator';
import { AuthResponseDto, CompleteAuthDto } from './dto/auth.dto';
import { ChannelPostsParamsDto, GetPostsQueryDto, HOURS_BACK_DEFAULT } from './dto/messages.dto';
import { GetPostsResponse } from './interfaces/message.interface';
import { TelegramService } from './telegram.service';

const MISSING_SESSION_MESSAGE = 'A session string is required in the x-session-string header';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  /**
   * GET /telegram/health
   * The only health probe: constant payload, no Telegram and no credential access.
   * Matches healthcheck_path in railway.toml.
   */
  @PublicRoute()
  @Get('health')
  @HttpCode(HttpStatus.OK)
  health(): { status: 'ok' } {
    return { status: 'ok' };
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
  @PhoneRateLimited()
  @Post('auth')
  @HttpCode(HttpStatus.OK)
  async authenticate(@Body() authDto: CompleteAuthDto): Promise<AuthResponseDto> {
    const { phoneNumber, phoneCode, password } = authDto;

    return await this.telegramService.authenticate(phoneNumber, phoneCode, password);
  }

  /**
   * GET /telegram/me
   * Проверяет валидность сессии — всегда 200, status: success | failed.
   * Строка сессии приходит заголовком x-session-string.
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async checkSession(
    @SessionString() sessionString: string,
  ): Promise<{ status: 'success' | 'failed' }> {
    if (!sessionString) {
      return { status: 'failed' };
    }

    return await this.telegramService.checkSession(sessionString);
  }

  /**
   * GET /telegram/channel/:channelUsername/posts
   * Получает посты канала за указанный период.
   *
   * Строка сессии приходит заголовком x-session-string, период — query-параметром hoursBack.
   */
  @Get('channel/:channelUsername/posts')
  async getChannelPosts(
    @Param() params: ChannelPostsParamsDto,
    @Query() query: GetPostsQueryDto,
    @SessionString() sessionString: string,
  ): Promise<GetPostsResponse> {
    if (!sessionString) {
      throw new BadRequestException(MISSING_SESSION_MESSAGE);
    }

    const hoursBack = query.hoursBack ?? HOURS_BACK_DEFAULT;

    return await this.telegramService.getChannelPosts(
      params.channelUsername,
      sessionString,
      hoursBack,
    );
  }
}
