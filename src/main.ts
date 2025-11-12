import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Обработка необработанных ошибок
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });

  try {
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log'],
    });

    // Enable CORS for accessing from external clients
    app.enableCors();

    // Graceful shutdown
    app.enableShutdownHooks();

    const port = process.env.PORT || 3000;

    // Слушаем на всех интерфейсах для Railway
    await app.listen(port, '0.0.0.0');

    // Немедленно логируем готовность - Railway может проверять health check сразу
    console.log(`🚀 Telegram Parser Service running on port ${port}`);
    console.log(`✅ Health check available at http://0.0.0.0:${port}/`);
    console.log(`✅ Application is ready to accept requests`);

    // Обработка сигналов для graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('SIGTERM received, shutting down gracefully...');
      try {
        await app.close();
        console.log('Application closed successfully');
      } catch (error) {
        console.error('Error during shutdown:', error);
      }
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('SIGINT received, shutting down gracefully...');
      try {
        await app.close();
        console.log('Application closed successfully');
      } catch (error) {
        console.error('Error during shutdown:', error);
      }
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap();
