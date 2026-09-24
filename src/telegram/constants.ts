/** Maximum number of live Telegram clients held in the session cache. */
export const SESSION_CACHE_MAX_ENTRIES = 50;

/** A cached client untouched for this long is evicted and released. */
export const SESSION_CACHE_IDLE_TTL_MS = 30 * 60 * 1000;

/** How often the background sweep looks for idle cache entries. */
export const SESSION_CACHE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** An unfinished auth flow older than this is dropped and its client released. */
export const AUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** How often the background sweep looks for expired auth flows. */
export const AUTH_STATE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Upper bound for every single call to Telegram. */
export const EXTERNAL_CALL_TIMEOUT_MS = 30_000;

/** Flood waits up to this many seconds are slept inside GramJS; longer ones surface as errors. */
export const FLOOD_SLEEP_THRESHOLD_S = 5;

/** Bounded connection attempts per connect call (GramJS default is Infinity). */
export const CONNECTION_RETRIES_COUNT = 3;

/** Bounded retries per request. */
export const REQUEST_RETRIES_COUNT = 3;

/** Delay between GramJS retry attempts. */
export const RETRY_DELAY_MS = 1000;

/** MTProto error codes meaning the session can never be used again. */
export const INVALID_SESSION_ERRORS = [
  'AUTH_KEY_UNREGISTERED',
  'AUTH_KEY_INVALID',
  'AUTH_KEY_PERM_EMPTY',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'USER_DEACTIVATED',
  'USER_DEACTIVATED_BAN',
] as const;

/** Messages requested from Telegram per page while walking a channel. */
export const POSTS_PAGE_SIZE = 100;

/** Upper bound on messages walked per request; a longer window is reported as truncated. */
export const POSTS_MAX_MESSAGES = 1000;

/** MTProto error codes meaning the channel does not exist or this account cannot read it. */
export const CHANNEL_UNAVAILABLE_ERRORS = [
  'USERNAME_INVALID',
  'USERNAME_NOT_OCCUPIED',
  'CHANNEL_INVALID',
  'CHANNEL_PRIVATE',
  'CHANNEL_PUBLIC_GROUP_NA',
] as const;

/** Message prefixes GramJS uses when it cannot resolve a username locally (not RPC errors). */
export const CHANNEL_LOOKUP_FAILURE_PREFIXES = ['No user has', 'Cannot find any entity'] as const;

/** MTProto codes limiting auth attempts for a phone without stating how long to wait. */
export const PHONE_FLOOD_ERRORS = ['PHONE_NUMBER_FLOOD', 'PHONE_PASSWORD_FLOOD'] as const;

/** Wait reported to the caller for PHONE_FLOOD_ERRORS, since Telegram gives no duration. */
export const PHONE_FLOOD_RETRY_AFTER_S = 3600;

const PHONE_NUMBER_UNUSABLE_MESSAGE = 'The phone number is invalid or cannot be used';

/** Auth-flow MTProto errors and the caller-facing message for each. */
export const AUTH_INPUT_ERRORS: ReadonlyArray<readonly [code: string, message: string]> = [
  ['PHONE_CODE_EXPIRED', 'The phone code has expired, request a new one'],
  ['PHONE_CODE_INVALID', 'The phone code is invalid'],
  ['PHONE_CODE_EMPTY', 'The phone code is missing'],
  ['PASSWORD_HASH_INVALID', 'The 2FA password is wrong'],
  ['PHONE_NUMBER_INVALID', PHONE_NUMBER_UNUSABLE_MESSAGE],
  // Same message as an invalid number, so the API cannot be used to probe whether a number is banned.
  ['PHONE_NUMBER_BANNED', PHONE_NUMBER_UNUSABLE_MESSAGE],
];

/** Signs of a transport failure in a non-RPC error message, rather than a Telegram verdict. */
export const CONNECTIVITY_ERRORS = ['Not connected', 'ECONNRESET', 'ECONNREFUSED'] as const;

/** Suffix of every error raised by `withTimeout`, and the MTProto code for a server-side timeout. */
export const TIMEOUT_SUFFIX = ' timeout';
export const RPC_TIMEOUT_CODE = 'TIMEOUT';

/** `withTimeout` label for connecting a client. */
export const CONNECTION_LABEL = 'Connection';

export const SECONDS_IN_HOUR = 3600;

/** MTProto code for a sign-in that must continue with the 2FA password. */
export const PASSWORD_NEEDED_ERROR = 'SESSION_PASSWORD_NEEDED';

/** Base of the public link to a channel post. */
export const POST_URL_BASE = 'https://t.me';
