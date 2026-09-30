/**
 * Runs before every E2E spec file, ahead of any import. ConfigModule loads the local .env but
 * never overrides a variable that is already defined, so blanking the Redis settings here keeps
 * a developer's REDIS_URL out of the run: every E2E app boots in memory-only session mode.
 */
process.env.REDIS_URL = '';
process.env.SESSION_ENCRYPTION_KEY = '';
