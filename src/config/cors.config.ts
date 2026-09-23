import { Logger } from '@nestjs/common';
import { API_KEY_HEADER, SESSION_HEADER } from '../shared/constants/http.constants';

const ORIGIN_SEPARATOR = ',';
const WILDCARD_ORIGIN = '*';

export const CORS_ORIGINS_ENV_VAR = 'CORS_ALLOWED_ORIGINS';
export const CORS_ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'] as const;
export const CORS_ALLOWED_HEADERS = ['Content-Type', API_KEY_HEADER, SESSION_HEADER] as const;
export const CORS_ALLOW_CREDENTIALS = false;

export interface CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  credentials: boolean;
}

const logger = new Logger('CorsConfig');

/**
 * Reads the browser origin allowlist from the environment.
 * An empty value means no browser origin is allowed, never a wildcard.
 */
export function getCorsConfig(): CorsConfig {
  const allowedOrigins = parseOrigins(process.env[CORS_ORIGINS_ENV_VAR] || '');

  if (allowedOrigins.length === 0) {
    logger.warn(`${CORS_ORIGINS_ENV_VAR} is empty: browser origins are not allowed`);
  }

  return {
    allowedOrigins,
    allowedMethods: [...CORS_ALLOWED_METHODS],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    credentials: CORS_ALLOW_CREDENTIALS,
  };
}

function parseOrigins(rawOrigins: string): string[] {
  const origins = rawOrigins
    .split(ORIGIN_SEPARATOR)
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const wildcards = origins.filter((origin) => origin === WILDCARD_ORIGIN);
  if (wildcards.length > 0) {
    logger.warn(`Wildcard origin in ${CORS_ORIGINS_ENV_VAR} is ignored`);
  }

  return origins.filter((origin) => origin !== WILDCARD_ORIGIN);
}
