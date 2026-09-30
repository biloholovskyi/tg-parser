export const CHANNEL_USERNAME_MIN_LENGTH = 5;
export const CHANNEL_USERNAME_MAX_LENGTH = 32;

const FIRST_CHARACTER_LENGTH = 1;

/** A public Telegram username, with an optional leading `@`. */
export const CHANNEL_USERNAME_PATTERN = new RegExp(
  `^@?[a-zA-Z][a-zA-Z0-9_]{${CHANNEL_USERNAME_MIN_LENGTH - FIRST_CHARACTER_LENGTH},${
    CHANNEL_USERNAME_MAX_LENGTH - FIRST_CHARACTER_LENGTH
  }}$`,
);
