import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DigestModule } from './digest/digest.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TelegramModule,
    DigestModule,
  ],
})
export class AppModule {}
