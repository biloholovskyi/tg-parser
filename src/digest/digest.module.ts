import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { getDigestConfig } from '../config/digest.config';
import { TelegramModule } from '../telegram/telegram.module';
import { DIGEST_CONFIG } from './constants';
import { BotNotifier } from './bot-notifier';
import { DigestController } from './digest.controller';
import { DigestScheduler } from './digest.scheduler';
import { DigestService } from './digest.service';
import { GrokClient } from './grok/grok.client';
import { PostCollector } from './post-collector';
import { SummaryService } from './summary.service';
import { TranslationService } from './translation.service';

@Module({
  imports: [ScheduleModule.forRoot(), TelegramModule],
  controllers: [DigestController],
  providers: [
    { provide: DIGEST_CONFIG, useFactory: getDigestConfig },
    PostCollector,
    GrokClient,
    TranslationService,
    SummaryService,
    BotNotifier,
    DigestService,
    DigestScheduler,
  ],
})
export class DigestModule {}
