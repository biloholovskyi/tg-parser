import { Logger } from '@nestjs/common';

const KEY_SEPARATOR = ',';

export const API_KEYS_ENV_VAR = 'API_KEYS';

export interface ApiKeysConfig {
  apiKeys: string[];
}

const logger = new Logger('ApiKeysConfig');

/**
 * Reads the caller API keys from the environment.
 * An empty value means no caller is authorized, never an open service.
 * Key values are never logged.
 */
export function getApiKeysConfig(): ApiKeysConfig {
  const apiKeys = parseApiKeys(process.env[API_KEYS_ENV_VAR] || '');

  if (apiKeys.length === 0) {
    logger.warn(`${API_KEYS_ENV_VAR} is empty: every authenticated route is closed`);
  }

  return { apiKeys };
}

function parseApiKeys(rawApiKeys: string): string[] {
  const apiKeys = rawApiKeys
    .split(KEY_SEPARATOR)
    .map((apiKey) => apiKey.trim())
    .filter((apiKey) => apiKey.length > 0);

  return [...new Set(apiKeys)];
}
