import { Controller, Get, HttpCode, HttpStatus, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramModule } from './telegram/telegram.module';

@Controller()
class AppController {
  @Get()
  @HttpCode(HttpStatus.OK)
  root() {
    return { status: 'ok', service: 'telegram-parser', timestamp: new Date().toISOString() };
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
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

