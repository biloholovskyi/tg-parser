import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from '../shared/guards/api-key.guard';
import { PhoneRateLimitGuard } from '../shared/guards/phone-rate-limit.guard';
import { RateLimitGuard } from '../shared/guards/rate-limit.guard';
import { AuthService } from './auth.service';
import { ChannelService } from './channel.service';
import { SessionStore } from './session-store';
import { TelegramClientFactory } from './telegram-client.factory';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';

@Module({
  controllers: [TelegramController],
  providers: [
    TelegramClientFactory,
    SessionStore,
    AuthService,
    ChannelService,
    TelegramService,
    // Order matters: an unauthenticated caller is rejected before any counter is touched.
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: PhoneRateLimitGuard },
  ],
  exports: [TelegramService],
})
export class TelegramModule {}
