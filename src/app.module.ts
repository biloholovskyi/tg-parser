import { Controller, Get, HttpCode, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramModule } from './telegram/telegram.module';

@Controller()
class AppController {
  @Get()
  @HttpCode(HttpStatus.OK)
  root() {
    // Максимально быстрый ответ для Railway health check
    return { status: 'ok', service: 'telegram-parser' };
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    // Максимально быстрый ответ для Railway health check
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TelegramModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
