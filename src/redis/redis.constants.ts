/** Injection token of the Redis client; its value is null when persistence is disabled. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Injection token of the session persistence config, or null when persistence is disabled. */
export const SESSION_PERSISTENCE_CONFIG = Symbol('SESSION_PERSISTENCE_CONFIG');

/** Upper bound for every single Redis command. */
export const REDIS_COMMAND_TIMEOUT_MS = 5000;

/** Upper bound for opening the Redis connection. */
export const REDIS_CONNECT_TIMEOUT_MS = 10_000;

/** Reconnect attempts a single command may wait for before it fails. */
export const REDIS_MAX_RETRIES = 2;

/** Reconnect delay grows by this step per attempt... */
export const REDIS_RECONNECT_STEP_MS = 500;

/** ...up to this ceiling, so an outage costs one attempt per ceiling interval. */
export const REDIS_RECONNECT_MAX_DELAY_MS = 30_000;
