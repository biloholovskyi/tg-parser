import { Logger } from '@nestjs/common';
import { API_KEYS_ENV_VAR, getApiKeysConfig } from './api-keys.config';

describe('getApiKeysConfig', () => {
  const originalEnv = process.env;
  const inputFirstApiKey = 'fake-api-key-one';
  const inputSecondApiKey = 'fake-api-key-two';

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'verbose').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('authorizes no caller and warns when the env var is unset', () => {
    delete process.env[API_KEYS_ENV_VAR];

    const actualConfig = getApiKeysConfig();

    expect(actualConfig.apiKeys).toEqual([]);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('authorizes no caller and warns when the env var is an empty string', () => {
    process.env[API_KEYS_ENV_VAR] = '';

    const actualConfig = getApiKeysConfig();

    expect(actualConfig.apiKeys).toEqual([]);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('authorizes no caller and warns when the env var holds only separators and whitespace', () => {
    process.env[API_KEYS_ENV_VAR] = ' , ,,  ';

    const actualConfig = getApiKeysConfig();

    expect(actualConfig.apiKeys).toEqual([]);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('reads a single key', () => {
    process.env[API_KEYS_ENV_VAR] = inputFirstApiKey;

    const actualConfig = getApiKeysConfig();

    expect(actualConfig.apiKeys).toEqual([inputFirstApiKey]);
  });

  it('reads several comma-separated keys and trims surrounding whitespace', () => {
    process.env[API_KEYS_ENV_VAR] = `  ${inputFirstApiKey} ,\t${inputSecondApiKey}  `;

    const actualConfig = getApiKeysConfig();

    expect(actualConfig.apiKeys).toEqual([inputFirstApiKey, inputSecondApiKey]);
  });

  it('drops empty entries produced by trailing separators', () => {
    process.env[API_KEYS_ENV_VAR] = `${inputFirstApiKey},,  ,`;

    const actualConfig = getApiKeysConfig();

    expect(actualConfig.apiKeys).toEqual([inputFirstApiKey]);
  });

  it('collapses duplicate keys, including ones that differ only by whitespace', () => {
    process.env[API_KEYS_ENV_VAR] =
      `${inputFirstApiKey}, ${inputFirstApiKey} ,${inputSecondApiKey}`;

    const actualConfig = getApiKeysConfig();

    expect(actualConfig.apiKeys).toEqual([inputFirstApiKey, inputSecondApiKey]);
  });

  it('emits no warning once at least one key is configured', () => {
    process.env[API_KEYS_ENV_VAR] = inputFirstApiKey;

    getApiKeysConfig();

    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  it('names the env var in the warning without leaking any key value', () => {
    process.env[API_KEYS_ENV_VAR] = '';

    getApiKeysConfig();

    const actualWarning = (Logger.prototype.warn as jest.Mock).mock.calls.flat().join(' ');
    expect(actualWarning).toContain(API_KEYS_ENV_VAR);
    expect(actualWarning).not.toContain(inputFirstApiKey);
  });

  it('passes no configured key value to any logger level', () => {
    process.env[API_KEYS_ENV_VAR] = `${inputFirstApiKey},${inputSecondApiKey}`;

    getApiKeysConfig();

    const loggedArguments = [
      Logger.prototype.warn,
      Logger.prototype.log,
      Logger.prototype.error,
      Logger.prototype.debug,
      Logger.prototype.verbose,
    ]
      .flatMap((loggerMethod) => (loggerMethod as jest.Mock).mock.calls.flat())
      .join(' ');

    expect(loggedArguments).not.toContain(inputFirstApiKey);
    expect(loggedArguments).not.toContain(inputSecondApiKey);
  });
});
