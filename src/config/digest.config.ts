import { Logger } from '@nestjs/common';
import { CHANNEL_USERNAME_PATTERN } from '../shared/constants/channel-username.constants';

export const DIGEST_CHANNELS_ENV_VAR = 'DIGEST_CHANNELS';
export const DIGEST_CRON_ENV_VAR = 'DIGEST_CRON';
export const DIGEST_TIMEZONE_ENV_VAR = 'DIGEST_TIMEZONE';
export const GROK_API_KEY_ENV_VAR = 'GROK_API_KEY';
export const GROK_MODEL_ENV_VAR = 'GROK_MODEL';
export const GROK_REASONING_EFFORT_ENV_VAR = 'GROK_REASONING_EFFORT';
export const DIGEST_TRANSLATION_ENV_VAR = 'DIGEST_TRANSLATION';
export const GROK_TRANSLATION_MODEL_ENV_VAR = 'GROK_TRANSLATION_MODEL';
export const GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR = 'GROK_TRANSLATION_REASONING_EFFORT';
export const TELEGRAM_BOT_TOKEN_ENV_VAR = 'TELEGRAM_BOT_TOKEN';
export const TELEGRAM_BOT_CHAT_ID_ENV_VAR = 'TELEGRAM_BOT_CHAT_ID';

/** Every day at 23:00 in DIGEST_TIMEZONE_DEFAULT. */
export const DIGEST_CRON_DEFAULT = '0 23 * * *';
export const DIGEST_TIMEZONE_DEFAULT = 'Europe/Kyiv';
/** The model xAI recommends for general text work (docs.x.ai, checked 25.09.2026). */
export const GROK_MODEL_DEFAULT = 'grok-4.6';

/** Reasoning levels xAI accepts, plus `off`: the parameter is not sent (for non-reasoning models). */
export const GROK_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'off'] as const;
export type GrokReasoningEffort = (typeof GROK_REASONING_EFFORTS)[number];
/** Translation and grouping need little thinking; the model's own default (`high`) takes minutes. */
export const GROK_REASONING_EFFORT_DEFAULT: GrokReasoningEffort = 'low';

/**
 * `off`: the summary reads the original posts and only fallback theses are translated;
 * `on`: every post is translated before the summary.
 */
export const DIGEST_TRANSLATION_MODES = ['off', 'on'] as const;
export type DigestTranslationMode = (typeof DIGEST_TRANSLATION_MODES)[number];
export const DIGEST_TRANSLATION_DEFAULT: DigestTranslationMode = 'off';

/** A non-reasoning general text model, cheaper than GROK_MODEL_DEFAULT (docs.x.ai, checked 14.10.2026). */
export const GROK_TRANSLATION_MODEL_DEFAULT = 'grok-4.20-0309-non-reasoning';
/** Translation needs no thinking; `off` leaves the parameter out of the request. */
export const GROK_TRANSLATION_REASONING_EFFORT_DEFAULT: GrokReasoningEffort = 'off';

/** Upper bound on channels read per run; the rest of the list is ignored with a warning. */
export const DIGEST_MAX_CHANNELS = 50;

const CHANNEL_SEPARATOR = ',';
const USERNAME_PREFIX = '@';

export interface DigestConfig {
  channels: string[];
  cron: string;
  timezone: string;
  grokApiKey: string;
  grokModel: string;
  grokReasoningEffort: GrokReasoningEffort;
  translationMode: DigestTranslationMode;
  grokTranslationModel: string;
  grokTranslationReasoningEffort: GrokReasoningEffort;
  botToken: string;
  botChatId: string;
  /** True when channels, the Grok key and the bot target are all present. */
  isConfigured: boolean;
}

const logger = new Logger('DigestConfig');

/**
 * Reads the digest settings. Missing parts disable the digest with one warning naming the
 * variables, never their values; boot never fails on it.
 */
export function getDigestConfig(): DigestConfig {
  const channels = parseChannels(readEnv(DIGEST_CHANNELS_ENV_VAR));
  const config = {
    channels,
    cron: readEnv(DIGEST_CRON_ENV_VAR) || DIGEST_CRON_DEFAULT,
    timezone: readEnv(DIGEST_TIMEZONE_ENV_VAR) || DIGEST_TIMEZONE_DEFAULT,
    grokApiKey: readEnv(GROK_API_KEY_ENV_VAR),
    grokModel: readEnv(GROK_MODEL_ENV_VAR) || GROK_MODEL_DEFAULT,
    grokReasoningEffort: parseChoice(
      GROK_REASONING_EFFORT_ENV_VAR,
      GROK_REASONING_EFFORTS,
      GROK_REASONING_EFFORT_DEFAULT,
    ),
    translationMode: parseChoice(
      DIGEST_TRANSLATION_ENV_VAR,
      DIGEST_TRANSLATION_MODES,
      DIGEST_TRANSLATION_DEFAULT,
    ),
    grokTranslationModel: readEnv(GROK_TRANSLATION_MODEL_ENV_VAR) || GROK_TRANSLATION_MODEL_DEFAULT,
    grokTranslationReasoningEffort: parseChoice(
      GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR,
      GROK_REASONING_EFFORTS,
      GROK_TRANSLATION_REASONING_EFFORT_DEFAULT,
    ),
    botToken: readEnv(TELEGRAM_BOT_TOKEN_ENV_VAR),
    botChatId: readEnv(TELEGRAM_BOT_CHAT_ID_ENV_VAR),
  };
  const missing = missingDigestVariables(config);
  if (missing.length > 0) {
    logger.warn(`Digest disabled, not set: ${missing.join(', ')}`);
  }
  return { ...config, isConfigured: missing.length === 0 };
}

/** An unknown value falls back to the default with one warning; the value itself is not secret. */
function parseChoice<T extends string>(envName: string, choices: readonly T[], defaultValue: T): T {
  const rawValue = readEnv(envName);
  if (!rawValue) {
    return defaultValue;
  }
  const value = choices.find((choice) => choice === rawValue.toLowerCase());
  if (!value) {
    logger.warn(
      `${envName}="${rawValue}" is not one of ${choices.join(', ')}: using ${defaultValue}`,
    );
    return defaultValue;
  }
  return value;
}

function readEnv(name: string): string {
  return (process.env[name] || '').trim();
}

/** Trims, drops a leading `@`, removes duplicates and names that are not valid usernames. */
function parseChannels(rawChannels: string): string[] {
  const names = rawChannels
    .split(CHANNEL_SEPARATOR)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const invalid = names.filter((name) => !CHANNEL_USERNAME_PATTERN.test(name));
  if (invalid.length > 0) {
    logger.warn(`${DIGEST_CHANNELS_ENV_VAR}: ${invalid.length} invalid channel name(s) skipped`);
  }
  const valid = names
    .filter((name) => CHANNEL_USERNAME_PATTERN.test(name))
    .map((name) => (name.startsWith(USERNAME_PREFIX) ? name.slice(1) : name));
  const unique = [...new Set(valid.map((name) => name.toLowerCase()))];
  if (unique.length > DIGEST_MAX_CHANNELS) {
    logger.warn(`${DIGEST_CHANNELS_ENV_VAR}: only the first ${DIGEST_MAX_CHANNELS} are read`);
  }
  return unique.slice(0, DIGEST_MAX_CHANNELS);
}

/** Names of the variables the digest still needs; empty when it can run. Never their values. */
export function missingDigestVariables(config: Omit<DigestConfig, 'isConfigured'>): string[] {
  const required: Array<[string, boolean]> = [
    [DIGEST_CHANNELS_ENV_VAR, config.channels.length > 0],
    [GROK_API_KEY_ENV_VAR, Boolean(config.grokApiKey)],
    [TELEGRAM_BOT_TOKEN_ENV_VAR, Boolean(config.botToken)],
    [TELEGRAM_BOT_CHAT_ID_ENV_VAR, Boolean(config.botChatId)],
  ];
  return required.filter(([, isSet]) => !isSet).map(([name]) => name);
}
