import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { API_KEYS_ENV_VAR, hasApiKeys } from '../config/api-keys.config';
import {
  REDIS_URL_ENV_VAR,
  SESSION_ENCRYPTION_KEY_ENV_VAR,
  isSessionPersistenceConfigured,
} from '../config/redis.config';
import { hasTelegramCredentials } from '../config/telegram.config';
import { AlertService } from './alert.service';

const TELEGRAM_CREDENTIAL_VARS = ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH'] as const;

/**
 * Sends one warning at boot naming the settings that leave the service degraded: no Telegram
 * credentials, no caller keys, no session persistence. Names only, never values; nothing when
 * the configuration is complete. The digest reports its own settings from DigestScheduler.
 */
@Injectable()
export class BootConfigReporter implements OnApplicationBootstrap {
  constructor(private readonly alerts: AlertService) {}

  onApplicationBootstrap(): void {
    const missing = findIncompleteSettings();
    if (missing.length > 0) {
      this.alerts.warning('Incomplete configuration at boot', { missing });
    }
  }
}

/** Variable names of every incomplete setting, in a fixed order. */
export function findIncompleteSettings(): string[] {
  return [
    ...(hasTelegramCredentials() ? [] : TELEGRAM_CREDENTIAL_VARS),
    ...(hasApiKeys() ? [] : [API_KEYS_ENV_VAR]),
    ...(isSessionPersistenceConfigured()
      ? []
      : [REDIS_URL_ENV_VAR, SESSION_ENCRYPTION_KEY_ENV_VAR]),
  ];
}
