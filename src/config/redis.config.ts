import { Logger } from '@nestjs/common';
import { SECRET_KEY_BYTES } from '../shared/utils/secret-cipher';

export const REDIS_URL_ENV_VAR = 'REDIS_URL';
export const SESSION_ENCRYPTION_KEY_ENV_VAR = 'SESSION_ENCRYPTION_KEY';

const KEY_ENCODING = 'base64';

/** Everything session persistence needs; absent means the service keeps sessions in memory only. */
export interface SessionPersistenceConfig {
  redisUrl: string;
  encryptionKey: Buffer;
}

const logger = new Logger('RedisConfig');

/**
 * Reads the Redis address and the session encryption key.
 * Either one missing or a key of the wrong length disables persistence with one warning;
 * boot never fails on it. Neither value is ever logged.
 */
export function getSessionPersistenceConfig(): SessionPersistenceConfig | null {
  const redisUrl = (process.env[REDIS_URL_ENV_VAR] || '').trim();
  const rawKey = (process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] || '').trim();

  if (!redisUrl) {
    logger.warn(`${REDIS_URL_ENV_VAR} is not set: sessions are kept in memory only`);
    return null;
  }
  const encryptionKey = Buffer.from(rawKey, KEY_ENCODING);
  if (encryptionKey.length !== SECRET_KEY_BYTES) {
    logger.warn(
      `${SESSION_ENCRYPTION_KEY_ENV_VAR} must be ${SECRET_KEY_BYTES} bytes in base64: ` +
        'sessions are kept in memory only',
    );
    return null;
  }

  return { redisUrl, encryptionKey };
}
