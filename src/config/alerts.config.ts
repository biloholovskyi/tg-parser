import { Logger } from '@nestjs/common';

export const ALERTS_URL_ENV_VAR = 'ALERTS_URL';
export const ALERTS_API_KEY_ENV_VAR = 'ALERTS_API_KEY';
export const ALERTS_SERVICE_NAME_ENV_VAR = 'ALERTS_SERVICE_NAME';

/** Name this service reports under when ALERTS_SERVICE_NAME is not set. */
export const ALERTS_SERVICE_NAME_DEFAULT = 'tg-parser';

/** The alert service caps `serviceName` at this length (`CreateAlertDto`). */
export const ALERT_SERVICE_NAME_MAX_CHARS = 100;

const ALLOWED_PROTOCOLS: readonly string[] = ['http:', 'https:'];
const TRAILING_SLASHES = /\/+$/;

export interface AlertsConfig {
  /** Base address of the alert service, without a trailing slash. */
  url: string;
  apiKey: string;
  serviceName: string;
  /** True when both the address and the API key are usable. */
  isEnabled: boolean;
}

const logger = new Logger('AlertsConfig');

/**
 * Reads the alert service settings. A missing or malformed part disables alerts with one
 * warning naming the variables, never their values; boot never fails on it.
 */
export function getAlertsConfig(): AlertsConfig {
  const url = parseUrl(readEnv(ALERTS_URL_ENV_VAR));
  const apiKey = readEnv(ALERTS_API_KEY_ENV_VAR);
  const serviceName = (readEnv(ALERTS_SERVICE_NAME_ENV_VAR) || ALERTS_SERVICE_NAME_DEFAULT).slice(
    0,
    ALERT_SERVICE_NAME_MAX_CHARS,
  );
  const missing = [
    ...(url ? [] : [ALERTS_URL_ENV_VAR]),
    ...(apiKey ? [] : [ALERTS_API_KEY_ENV_VAR]),
  ];
  if (missing.length > 0) {
    logger.warn(`Alerts disabled, not set or invalid: ${missing.join(', ')}`);
  }
  return { url, apiKey, serviceName, isEnabled: missing.length === 0 };
}

/** An absolute http(s) address without trailing slashes, or an empty string when unusable. */
function parseUrl(rawUrl: string): string {
  if (!rawUrl) {
    return '';
  }
  try {
    const parsed = new URL(rawUrl);
    return ALLOWED_PROTOCOLS.includes(parsed.protocol) ? rawUrl.replace(TRAILING_SLASHES, '') : '';
  } catch {
    return '';
  }
}

function readEnv(name: string): string {
  return (process.env[name] || '').trim();
}
