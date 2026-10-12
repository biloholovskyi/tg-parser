/** Injection token of the alert service settings read by `getAlertsConfig`. */
export const ALERTS_CONFIG = Symbol('ALERTS_CONFIG');

/** Ingest route of the alert service, appended to ALERTS_URL. */
export const ALERTS_INGEST_PATH = '/alerts';

/** Upper bound for one alert request. */
export const ALERT_CALL_TIMEOUT_MS = 10_000;

/** Extra attempts after the first one, only for network failures, timeouts and 5xx. */
export const ALERT_MAX_RETRIES = 1;

/** Wait before a retry. */
export const ALERT_RETRY_DELAY_MS = 1000;

/** Alerts waiting to be sent; a new alert beyond it is dropped and counted. */
export const ALERT_QUEUE_MAX_SIZE = 100;

/** Alert requests in flight at the same time. */
export const ALERT_MAX_CONCURRENT = 2;

/** A warning or error with the same level and message inside this window is not sent again. */
export const ALERT_DEDUP_WINDOW_MS = 10 * 60 * 1000;

/** Distinct alert keys remembered for deduplication; the oldest is forgotten beyond it. */
export const ALERT_DEDUP_MAX_KEYS = 200;

/** Shutdown waits this long for queued alerts; kept below SHUTDOWN_TIMEOUT_MS. */
export const ALERT_DRAIN_TIMEOUT_MS = 5000;

/** The alert service caps `message` at this length (`CreateAlertDto`). */
export const ALERT_MESSAGE_MAX_CHARS = 4000;

/** Serialized `details` longer than this are replaced by a truncated preview. */
export const ALERT_DETAILS_MAX_CHARS = 3000;

/** Nesting levels of `details` kept; deeper values are replaced by a marker. */
export const ALERT_DETAILS_MAX_DEPTH = 3;

/** Items kept from one array inside `details`. */
export const ALERT_DETAILS_MAX_ITEMS = 50;

/** Replacement for a value that looks like a secret. */
export const ALERT_REDACTED = '[redacted]';

/** Replacement for a value nested deeper than ALERT_DETAILS_MAX_DEPTH. */
export const ALERT_TOO_DEEP = '[too deep]';
