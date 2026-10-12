/** Injection token of the digest settings read by `getDigestConfig`. */
export const DIGEST_CONFIG = Symbol('DIGEST_CONFIG');

/** Each run covers the posts of this many hours before it started. */
export const DIGEST_WINDOW_HOURS = 24;

/** Prefix of the short post reference (`p1`, `p2`, ...) the model sees instead of a URL. */
export const POST_REF_PREFIX = 'p';

/** xAI chat completions endpoint (OpenAI-compatible). */
export const GROK_CHAT_COMPLETIONS_URL = 'https://api.x.ai/v1/chat/completions';

/** Upper bound for one ordinary Grok call: a translation batch or a coverage follow-up. */
export const GROK_CALL_TIMEOUT_MS = 180_000;

/**
 * Upper bound for the one whole-day summary request, a long generation. It is not retried after
 * a timeout: the same request would only time out again.
 */
export const GROK_SUMMARY_TIMEOUT_MS = 30 * 60 * 1000;

/** Retries of the summary request after a fast failure (429, 5xx, network, unusable answer). */
export const GROK_SUMMARY_MAX_RETRIES = 1;

/** Extra attempts after the first one, only for 429, 5xx, timeouts and unusable answers. */
export const GROK_MAX_RETRIES = 2;

/** Wait before retry N is N times this. */
export const GROK_RETRY_BASE_DELAY_MS = 2000;

/** Character budget of one translation request. */
export const GROK_TRANSLATE_BATCH_CHARS = 12_000;

/** A post longer than this is cut before translation. */
export const DIGEST_POST_MAX_CHARS = 1500;

/** A translated post longer than this is cut before summarizing; a thesis needs the gist only. */
export const SUMMARY_POST_MAX_CHARS = 800;

/** Translation starts no new batch after this long; the rest keeps the original text. */
export const TRANSLATION_BUDGET_MS = 60 * 60 * 1000;

/** Follow-up requests for posts the model left out of the translation. */
export const TRANSLATION_MISSING_RETRIES = 1;

/** Follow-up requests for posts the model left out of the summary. */
export const SUMMARY_COVERAGE_RETRIES = 2;

/** A post the model never placed becomes its own block with this many characters of text. */
export const DIGEST_FALLBACK_THESIS_CHARS = 200;

/** Upper bound on posts per run; beyond it the oldest are left out and the footer says how many. */
export const DIGEST_MAX_POSTS = 600;

/** Links printed per line under a thesis, so a long list wraps instead of forming one huge line. */
export const DIGEST_LINKS_PER_LINE = 8;

/** Name of the scheduled job in SchedulerRegistry. */
export const DIGEST_JOB_NAME = 'daily-digest';

/** Telegram Bot API base; the bot token follows in the path and is never logged. */
export const BOT_API_BASE_URL = 'https://api.telegram.org';

/** Telegram limit for one message. */
export const BOT_MESSAGE_MAX_CHARS = 4096;

/** Upper bound for one Bot API call. */
export const BOT_CALL_TIMEOUT_MS = 30_000;

/** Extra attempts per message after the first one. */
export const BOT_MAX_RETRIES = 3;

/** Wait before retry N of a transient failure is N times this. */
export const BOT_RETRY_BASE_DELAY_MS = 1000;

/** A `retry_after` longer than this is not waited for; the run reports the failure instead. */
export const BOT_MAX_RETRY_AFTER_S = 60;
