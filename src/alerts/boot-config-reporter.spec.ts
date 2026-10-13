import { Logger } from '@nestjs/common';
import { API_KEYS_ENV_VAR } from '../config/api-keys.config';
import { REDIS_URL_ENV_VAR, SESSION_ENCRYPTION_KEY_ENV_VAR } from '../config/redis.config';
import { SECRET_KEY_BYTES } from '../shared/utils/secret-cipher';
import type { AlertService } from './alert.service';
import { BootConfigReporter, findIncompleteSettings } from './boot-config-reporter';

const TELEGRAM_API_ID_ENV_VAR = 'TELEGRAM_API_ID';
const TELEGRAM_API_HASH_ENV_VAR = 'TELEGRAM_API_HASH';
const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
const KEY_FILL_BYTE = 7;
const INCOMPLETE_MESSAGE = 'Incomplete configuration at boot';

const inputApiId = '12345';
const inputApiHash = 'fake-api-hash';
const inputApiKeys = 'fake-api-key-one';
const inputRedisUrl = 'redis://fake-user:fake-password@fake-redis.invalid:6379';
const inputKey = Buffer.alloc(SECRET_KEY_BYTES, KEY_FILL_BYTE).toString('base64');
const inputShortKey = Buffer.alloc(SECRET_KEY_BYTES - 1, KEY_FILL_BYTE).toString('base64');

const ALL_VARS = [
  TELEGRAM_API_ID_ENV_VAR,
  TELEGRAM_API_HASH_ENV_VAR,
  API_KEYS_ENV_VAR,
  REDIS_URL_ENV_VAR,
  SESSION_ENCRYPTION_KEY_ENV_VAR,
];

/** Every value set to an obvious fake that makes its setting complete. */
function setCompleteEnv(): void {
  process.env[TELEGRAM_API_ID_ENV_VAR] = inputApiId;
  process.env[TELEGRAM_API_HASH_ENV_VAR] = inputApiHash;
  process.env[API_KEYS_ENV_VAR] = inputApiKeys;
  process.env[REDIS_URL_ENV_VAR] = inputRedisUrl;
  process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = inputKey;
}

describe('findIncompleteSettings', () => {
  const originalEnv = process.env;
  let loggerSpies: jest.SpyInstance[];

  beforeEach(() => {
    process.env = { ...originalEnv };
    ALL_VARS.forEach((name) => delete process.env[name]);
    loggerSpies = LOGGER_LEVELS.map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('returns an empty list when every setting is complete, without logging', () => {
    // Arrange
    setCompleteEnv();

    // Act
    const actualMissing = findIncompleteSettings();

    // Assert
    expect(actualMissing).toEqual([]);
    loggerSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it('names every variable in the fixed order when nothing is set, without logging', () => {
    // Arrange: every variable already removed

    // Act
    const actualMissing = findIncompleteSettings();

    // Assert
    expect(actualMissing).toEqual([
      TELEGRAM_API_ID_ENV_VAR,
      TELEGRAM_API_HASH_ENV_VAR,
      API_KEYS_ENV_VAR,
      REDIS_URL_ENV_VAR,
      SESSION_ENCRYPTION_KEY_ENV_VAR,
    ]);
    loggerSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });

  it.each([
    [
      'the api hash is missing',
      TELEGRAM_API_HASH_ENV_VAR,
      [TELEGRAM_API_ID_ENV_VAR, TELEGRAM_API_HASH_ENV_VAR],
    ],
    [
      'the api id is missing',
      TELEGRAM_API_ID_ENV_VAR,
      [TELEGRAM_API_ID_ENV_VAR, TELEGRAM_API_HASH_ENV_VAR],
    ],
    ['the caller keys are missing', API_KEYS_ENV_VAR, [API_KEYS_ENV_VAR]],
    [
      'the Redis URL is missing',
      REDIS_URL_ENV_VAR,
      [REDIS_URL_ENV_VAR, SESSION_ENCRYPTION_KEY_ENV_VAR],
    ],
    [
      'the encryption key is missing',
      SESSION_ENCRYPTION_KEY_ENV_VAR,
      [REDIS_URL_ENV_VAR, SESSION_ENCRYPTION_KEY_ENV_VAR],
    ],
  ])('names the whole setting when %s', (_label, inputRemoved, expectedMissing) => {
    // Arrange
    setCompleteEnv();
    delete process.env[inputRemoved];

    // Act
    const actualMissing = findIncompleteSettings();

    // Assert
    expect(actualMissing).toEqual(expectedMissing);
  });

  it('treats an encryption key of the wrong length as incomplete persistence', () => {
    // Arrange
    setCompleteEnv();
    process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = inputShortKey;

    // Act
    const actualMissing = findIncompleteSettings();

    // Assert
    expect(actualMissing).toEqual([REDIS_URL_ENV_VAR, SESSION_ENCRYPTION_KEY_ENV_VAR]);
  });
});

describe('BootConfigReporter', () => {
  const originalEnv = process.env;
  let mockAlerts: { info: jest.Mock; warning: jest.Mock; error: jest.Mock };

  function createReporter(): BootConfigReporter {
    return new BootConfigReporter(mockAlerts as unknown as AlertService);
  }

  beforeEach(() => {
    process.env = { ...originalEnv };
    ALL_VARS.forEach((name) => delete process.env[name]);
    mockAlerts = { info: jest.fn(), warning: jest.fn(), error: jest.fn() };
    LOGGER_LEVELS.forEach((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('sends nothing when the configuration is complete', () => {
    // Arrange
    setCompleteEnv();
    const reporter = createReporter();

    // Act
    reporter.onApplicationBootstrap();

    // Assert
    expect(mockAlerts.info).not.toHaveBeenCalled();
    expect(mockAlerts.warning).not.toHaveBeenCalled();
    expect(mockAlerts.error).not.toHaveBeenCalled();
  });

  it('sends one warning naming the incomplete variables', () => {
    // Arrange
    setCompleteEnv();
    delete process.env[API_KEYS_ENV_VAR];
    process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = inputShortKey;
    const reporter = createReporter();

    // Act
    reporter.onApplicationBootstrap();

    // Assert
    expect(mockAlerts.warning).toHaveBeenCalledTimes(1);
    expect(mockAlerts.warning).toHaveBeenCalledWith(INCOMPLETE_MESSAGE, {
      missing: [API_KEYS_ENV_VAR, REDIS_URL_ENV_VAR, SESSION_ENCRYPTION_KEY_ENV_VAR],
    });
    expect(mockAlerts.error).not.toHaveBeenCalled();
  });

  it('never puts a configured value into the warning', () => {
    // Arrange
    setCompleteEnv();
    delete process.env[TELEGRAM_API_ID_ENV_VAR];
    process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = inputShortKey;
    const reporter = createReporter();

    // Act
    reporter.onApplicationBootstrap();

    // Assert
    const actualText = JSON.stringify(mockAlerts.warning.mock.calls);
    expect(actualText).not.toContain(inputApiHash);
    expect(actualText).not.toContain(inputApiKeys);
    expect(actualText).not.toContain(inputRedisUrl);
    expect(actualText).not.toContain('fake-password');
    expect(actualText).not.toContain(inputShortKey);
  });
});
