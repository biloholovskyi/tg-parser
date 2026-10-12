import { Logger } from '@nestjs/common';
import { SECRET_KEY_BYTES } from '../shared/utils/secret-cipher';
import {
  REDIS_URL_ENV_VAR,
  SESSION_ENCRYPTION_KEY_ENV_VAR,
  getSessionPersistenceConfig,
} from './redis.config';

const KEY_ENCODING = 'base64';
const inputRedisUrl = 'redis://fake-user:fake-password@fake-redis.invalid:6379';
const inputKeyBytes = Buffer.alloc(SECRET_KEY_BYTES, 7);
const inputKey = inputKeyBytes.toString(KEY_ENCODING);
const inputShortKey = Buffer.alloc(SECRET_KEY_BYTES - 1, 7).toString(KEY_ENCODING);
const inputLongKey = Buffer.alloc(SECRET_KEY_BYTES + 1, 7).toString(KEY_ENCODING);

describe('getSessionPersistenceConfig', () => {
  const originalUrl = process.env[REDIS_URL_ENV_VAR];
  const originalKey = process.env[SESSION_ENCRYPTION_KEY_ENV_VAR];
  let mockWarn: jest.SpyInstance;

  function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  function warnedText(): string {
    return mockWarn.mock.calls.flat().map(String).join(' | ');
  }

  beforeEach(() => {
    delete process.env[REDIS_URL_ENV_VAR];
    delete process.env[SESSION_ENCRYPTION_KEY_ENV_VAR];
    mockWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    restoreEnv(REDIS_URL_ENV_VAR, originalUrl);
    restoreEnv(SESSION_ENCRYPTION_KEY_ENV_VAR, originalKey);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('returns null with one warning when REDIS_URL is %s', (_label, inputUrl) => {
    // Arrange
    if (inputUrl !== undefined) {
      process.env[REDIS_URL_ENV_VAR] = inputUrl;
    }
    process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = inputKey;

    // Act
    const actualConfig = getSessionPersistenceConfig();

    // Assert
    expect(actualConfig).toBeNull();
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(warnedText()).toContain(REDIS_URL_ENV_VAR);
    expect(warnedText()).not.toContain(inputKey);
  });

  it.each([
    ['missing', undefined],
    ['too short', inputShortKey],
    ['too long', inputLongKey],
    ['not base64 of 32 bytes', 'fake-not-a-key'],
  ])('returns null with one warning when the key is %s', (_label, inputBadKey) => {
    // Arrange
    process.env[REDIS_URL_ENV_VAR] = inputRedisUrl;
    if (inputBadKey !== undefined) {
      process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = inputBadKey;
    }

    // Act
    const actualConfig = getSessionPersistenceConfig();

    // Assert
    expect(actualConfig).toBeNull();
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(warnedText()).toContain(SESSION_ENCRYPTION_KEY_ENV_VAR);
    expect(warnedText()).not.toContain(inputRedisUrl);
    expect(warnedText()).not.toContain('fake-password');
    if (inputBadKey) {
      expect(warnedText()).not.toContain(inputBadKey);
    }
  });

  it('returns the URL and the decoded 32-byte key without warning when both are valid', () => {
    // Arrange
    process.env[REDIS_URL_ENV_VAR] = inputRedisUrl;
    process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = inputKey;

    // Act
    const actualConfig = getSessionPersistenceConfig();

    // Assert
    expect(actualConfig).not.toBeNull();
    expect(actualConfig?.redisUrl).toBe(inputRedisUrl);
    expect(actualConfig?.encryptionKey.equals(inputKeyBytes)).toBe(true);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace from both values', () => {
    // Arrange
    process.env[REDIS_URL_ENV_VAR] = `  ${inputRedisUrl}\n`;
    process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = ` ${inputKey}\t`;

    // Act
    const actualConfig = getSessionPersistenceConfig();

    // Assert
    expect(actualConfig?.redisUrl).toBe(inputRedisUrl);
    expect(actualConfig?.encryptionKey.equals(inputKeyBytes)).toBe(true);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('never logs the URL or the key at any level', () => {
    // Arrange
    const levels = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;
    mockWarn.mockRestore();
    const mockSpies = levels.map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    process.env[REDIS_URL_ENV_VAR] = inputRedisUrl;
    process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = inputShortKey;

    // Act
    getSessionPersistenceConfig();
    process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = inputKey;
    getSessionPersistenceConfig();

    // Assert
    const actualText = mockSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((argument) => String(argument))
      .join(' | ');
    expect(actualText).not.toContain(inputRedisUrl);
    expect(actualText).not.toContain('fake-password');
    expect(actualText).not.toContain(inputKey);
    expect(actualText).not.toContain(inputShortKey);
  });
});
