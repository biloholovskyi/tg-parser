import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import {
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_CONNECT_TIMEOUT_MS,
  REDIS_MAX_RETRIES,
  REDIS_RECONNECT_MAX_DELAY_MS,
  REDIS_RECONNECT_STEP_MS,
} from './redis.constants';

/** Resolve both IPv4 and IPv6: Railway's private network answers over IPv6 only. */
const IP_FAMILY_ANY = 0;

const logger = new Logger('Redis');

/** Delay before the next reconnect attempt; never gives up, never retries in a tight loop. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(attempt * REDIS_RECONNECT_STEP_MS, REDIS_RECONNECT_MAX_DELAY_MS);
}

/**
 * The single place a Redis client is constructed, always with explicit bounds.
 * The URL carries the password, so it is never logged; errors are logged once per outage.
 */
export function createRedisClient(redisUrl: string): Redis {
  const client = new Redis(redisUrl, {
    family: IP_FAMILY_ANY,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: REDIS_MAX_RETRIES,
    retryStrategy: reconnectDelayMs,
  });
  watchConnection(client);
  return client;
}

/** One line when the connection breaks and one when it is back, not one per reconnect attempt. */
function watchConnection(client: Redis): void {
  let isHealthy = true;
  client.on('error', (error: Error & { code?: string }) => {
    if (isHealthy) {
      isHealthy = false;
      logger.error(`Connection error (${error.code ?? error.name})`);
    }
  });
  client.on('ready', () => {
    logger.log(isHealthy ? 'Connected' : 'Connection restored');
    isHealthy = true;
  });
}

/** Closes the connection politely when it is up, and drops it at once otherwise. */
export async function closeRedisClient(client: Redis): Promise<void> {
  if (client.status !== 'ready') {
    client.disconnect();
    return;
  }
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
