import {
  ALERT_DETAILS_MAX_CHARS,
  ALERT_DETAILS_MAX_DEPTH,
  ALERT_DETAILS_MAX_ITEMS,
  ALERT_MESSAGE_MAX_CHARS,
  ALERT_REDACTED,
  ALERT_TOO_DEEP,
} from './constants';
import type {
  AlertDetailValue,
  AlertDetails,
  AlertLevel,
  AlertPayload,
} from './interfaces/alert.interface';

/** Same shape the repository guard blocks: a GramJS StringSession is a long base64 run. */
const SESSION_STRING_PATTERN = /\b1[A-Za-z0-9+/=_-]{199,}/g;
/** A phone number in international form; bare digit runs stay, they are ids and counters. */
const PHONE_NUMBER_PATTERN = /\+\d[\d\s()-]{6,}\d/g;
/**
 * Fragments of details keys whose value is a credential or a personal identifier, matched inside
 * the normalized key, so `X-API-Key`, `accessToken` and `clientSecret` are dropped too.
 */
const FORBIDDEN_KEY_FRAGMENTS: readonly string[] = [
  'session',
  'phone',
  'password',
  'apihash',
  'apikey',
  'token',
  'authorization',
  'secret',
];
const NON_ALPHANUMERIC = /[^a-z0-9]/g;

/** Builds the body of `POST /alerts` with every caller-supplied value sanitized. */
export function buildAlertPayload(
  serviceName: string,
  level: AlertLevel,
  message: string,
  details?: AlertDetails,
): AlertPayload {
  const sanitized = details ? sanitizeDetails(details) : undefined;
  return {
    serviceName,
    level,
    message: sanitizeMessage(message),
    ...(sanitized ? { details: sanitized } : {}),
  };
}

/** Redacts secrets and cuts the message to the length the alert service accepts. */
export function sanitizeMessage(message: string): string {
  return redactText(message).slice(0, ALERT_MESSAGE_MAX_CHARS);
}

/**
 * Keeps JSON-safe values only, drops forbidden keys, redacts secret-looking strings and bounds
 * depth, array length and the serialized size. Empty details become `undefined`.
 */
export function sanitizeDetails(
  details: AlertDetails,
): Record<string, AlertDetailValue> | undefined {
  const sanitized = sanitizeObject(details, 1);
  if (Object.keys(sanitized).length === 0) {
    return undefined;
  }
  const serialized = JSON.stringify(sanitized);
  if (serialized.length <= ALERT_DETAILS_MAX_CHARS) {
    return sanitized;
  }
  return { truncated: true, preview: serialized.slice(0, ALERT_DETAILS_MAX_CHARS) };
}

export function redactText(text: string): string {
  return text
    .replace(SESSION_STRING_PATTERN, ALERT_REDACTED)
    .replace(PHONE_NUMBER_PATTERN, ALERT_REDACTED);
}

function sanitizeObject(
  source: Readonly<Record<string, unknown>>,
  depth: number,
): Record<string, AlertDetailValue> {
  const result: Record<string, AlertDetailValue> = {};
  for (const [key, value] of Object.entries(source)) {
    if (isForbiddenKey(key)) {
      continue;
    }
    const sanitized = sanitizeValue(value, depth);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }
  return result;
}

function sanitizeValue(value: unknown, depth: number): AlertDetailValue | undefined {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== 'object') {
    return undefined;
  }
  if (depth >= ALERT_DETAILS_MAX_DEPTH) {
    return ALERT_TOO_DEEP;
  }
  return Array.isArray(value)
    ? sanitizeArray(value, depth + 1)
    : sanitizeObject(value as Record<string, unknown>, depth + 1);
}

function sanitizeArray(values: readonly unknown[], depth: number): AlertDetailValue[] {
  return values
    .slice(0, ALERT_DETAILS_MAX_ITEMS)
    .map((item) => sanitizeValue(item, depth))
    .filter((item): item is AlertDetailValue => item !== undefined);
}

function isForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(NON_ALPHANUMERIC, '');
  return FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}
