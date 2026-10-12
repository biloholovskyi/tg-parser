import { BadRequestException, Controller, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { SessionString } from '../shared/decorators/session-string.decorator';
import { MISSING_SESSION_MESSAGE } from '../shared/utils/session-header';
import { TelegramService } from '../telegram/telegram.service';
import { DigestService } from './digest.service';
import type { DigestRunResponse } from './interfaces/digest-run.interface';

@Controller('digest')
export class DigestController {
  constructor(
    private readonly telegramService: TelegramService,
    private readonly digestService: DigestService,
  ) {}

  /**
   * POST /digest/run
   * Запускает сбор дайджеста сейчас; результат приходит в Telegram-бота.
   * 202 — запуск начат; 409 — запуск уже идёт; 503 — дайджест не настроен.
   */
  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  run(): DigestRunResponse {
    return this.digestService.start();
  }

  /**
   * PUT /digest/session
   * Отмечает сессию из заголовка x-session-string как сессию ежедневного дайджеста.
   * 204 — отмечена; 400 — нет заголовка; 401 — сессия неизвестна или отозвана.
   */
  @Put('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markSession(@SessionString() sessionString: string): Promise<void> {
    if (!sessionString) {
      throw new BadRequestException(MISSING_SESSION_MESSAGE);
    }
    await this.telegramService.markDigestSession(sessionString);
  }
}
