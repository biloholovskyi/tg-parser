import { Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import type Redis from 'ioredis';
import { getSessionPersistenceConfig } from '../config/redis.config';
import type { SessionPersistenceConfig } from '../config/redis.config';
import { closeRedisClient, createRedisClient } from './redis-client';
import { REDIS_CLIENT, SESSION_PERSISTENCE_CONFIG } from './redis.constants';

const logger = new Logger('RedisModule');

/**
 * Provides the Redis client and the session persistence config, both null when persistence is
 * not configured. The connection is closed on application shutdown, which Nest runs after every
 * onModuleDestroy, so Telegram clients are released before Redis goes away.
 */
@Module({
  providers: [
    { provide: SESSION_PERSISTENCE_CONFIG, useFactory: getSessionPersistenceConfig },
    {
      provide: REDIS_CLIENT,
      inject: [SESSION_PERSISTENCE_CONFIG],
      useFactory: (config: SessionPersistenceConfig | null): Redis | null => {
        if (!config) {
          return null;
        }
        logger.log('Session persistence: Redis');
        return createRedisClient(config.redisUrl);
      },
    },
  ],
  exports: [REDIS_CLIENT, SESSION_PERSISTENCE_CONFIG],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis) {
      await closeRedisClient(this.redis);
    }
  }
}
