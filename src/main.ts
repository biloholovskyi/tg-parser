import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AlertService } from './alerts/alert.service';
import { sendBootFailureAlert } from './alerts/boot-failure-alert';
import { AppModule } from './app.module';
import { DEFAULT_PORT } from './shared/constants/http.constants';
import { configureHttpPipeline } from './shared/utils/http-pipeline';
import {
  EXIT_CODE_FAILURE,
  describeError,
  registerProcessHandlers,
} from './shared/utils/process-handlers';

const LISTEN_HOST = '0.0.0.0';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  try {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
      logger: ['error', 'warn', 'log'],
      bodyParser: false,
    });

    // Request body limit, global validation and the CORS allowlist
    configureHttpPipeline(app);

    // Single shutdown path: these handlers close the app, which runs the lifecycle hooks.
    // Nest's own enableShutdownHooks is deliberately not used: it would add a second
    // signal listener and re-raise the signal while this close is still running.
    registerProcessHandlers(app, app.get(AlertService));

    const port = process.env.PORT || DEFAULT_PORT;
    await app.listen(port, LISTEN_HOST);

    logger.log(`Telegram parser service listening on port ${port}`);
    logger.log(`Health check available at /telegram/health`);
  } catch (error: unknown) {
    // Deliberate startup failure: there is no application to close yet.
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to start application: ${reason}`);
    await sendBootFailureAlert(describeError(error));
    process.exit(EXIT_CODE_FAILURE);
  }
}

void bootstrap();
