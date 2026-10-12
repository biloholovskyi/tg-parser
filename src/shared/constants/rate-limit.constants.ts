const SECONDS_IN_MINUTE = 60;
const MINUTES_IN_HOUR = 60;

export const MS_IN_SECOND = 1000;

// Per caller key, every route except the health probe (RATE_LIMIT_DEFAULT).
export const RATE_LIMIT_DEFAULT_MAX_REQUESTS = 60;
export const RATE_LIMIT_DEFAULT_WINDOW_MS = SECONDS_IN_MINUTE * MS_IN_SECOND;

// Per phone number on the auth route (RATE_LIMIT_AUTH): the cost lands on the
// Telegram application, not on the caller, so the key is not the subject.
export const RATE_LIMIT_AUTH_MAX_REQUESTS = 5;
export const RATE_LIMIT_AUTH_WINDOW_MS = MINUTES_IN_HOUR * SECONDS_IN_MINUTE * MS_IN_SECOND;

// Ceiling per store: a counter map that only grows is the same leak as an unbounded cache.
export const RATE_LIMIT_STORE_MAX_ENTRIES = 1000;
