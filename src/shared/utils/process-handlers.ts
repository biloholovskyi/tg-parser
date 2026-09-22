import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;
export const SHUTDOWN_TIMEOUT_MS = 10_000;
export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_FAILURE = 1;

const logger = new Logger('Process');

let isShuttingDown = false;

/**
 * Registers the top-level process handlers.
 * A background rejection is logged and the process keeps serving requests;
 * only a deliberate shutdown path ends the process.
 */
export function registerProcessHandlers(app: INestApplication): void {
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error(`Unhandled promise rejection: ${describeError(reason)}`);
  });

  process.on('uncaughtException', (error: unknown) => {
    logger.error(`Uncaught exception: ${describeError(error)}`);
    void closeApplication(app, EXIT_CODE_FAILURE);
  });

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      logger.log(`${signal} received, shutting down gracefully`);
      void closeApplication(app, EXIT_CODE_SUCCESS);
    });
  }
}

/**
 * Closes the application so lifecycle hooks run, then ends the process.
 * This is the only deliberate exit path: it runs once and always terminates,
 * even when closing hangs, so the platform can restart the instance.
 */
export async function closeApplication(app: INestApplication, exitCode: number): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  try {
    await withTimeout(app.close());
    logger.log('Application closed successfully');
  } catch (error: unknown) {
    logger.error(`Error during shutdown: ${describeError(error)}`);
  }

  process.exit(exitCode);
}

/**
 * Test seam: clears the one-shot shutdown latch.
 */
export function resetShutdownState(): void {
  isShuttingDown = false;
}

/**
 * Extracts a log-safe description of an unknown error: never a request payload.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return typeof error === 'string' ? error : 'unknown error';
}

async function withTimeout(closing: Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS}ms`)),
      SHUTDOWN_TIMEOUT_MS,
    );
    timer.unref();
  });

  try {
    await Promise.race([closing, expiry]);
  } finally {
    clearTimeout(timer);
  }
}
