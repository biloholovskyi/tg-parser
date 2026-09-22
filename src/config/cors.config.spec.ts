import { Logger } from '@nestjs/common';
import {
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  CORS_ALLOW_CREDENTIALS,
  CORS_ORIGINS_ENV_VAR,
  getCorsConfig,
} from './cors.config';

describe('getCorsConfig', () => {
  const originalEnv = process.env;
  const inputFirstOrigin = 'https://app.example.com';
  const inputSecondOrigin = 'https://admin.example.com';
  const inputWildcardOrigin = '*';

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('allows no origin and warns when the env var is unset', () => {
    delete process.env[CORS_ORIGINS_ENV_VAR];

    const actualConfig = getCorsConfig();

    expect(actualConfig.allowedOrigins).toEqual([]);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('allows no origin and warns when the env var is an empty string', () => {
    process.env[CORS_ORIGINS_ENV_VAR] = '';

    const actualConfig = getCorsConfig();

    expect(actualConfig.allowedOrigins).toEqual([]);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('reads a single origin', () => {
    process.env[CORS_ORIGINS_ENV_VAR] = inputFirstOrigin;

    const actualConfig = getCorsConfig();

    expect(actualConfig.allowedOrigins).toEqual([inputFirstOrigin]);
  });

  it('reads several comma-separated origins and trims surrounding whitespace', () => {
    process.env[CORS_ORIGINS_ENV_VAR] = `  ${inputFirstOrigin} ,\t${inputSecondOrigin}  `;

    const actualConfig = getCorsConfig();

    expect(actualConfig.allowedOrigins).toEqual([inputFirstOrigin, inputSecondOrigin]);
  });

  it('drops empty entries produced by trailing separators', () => {
    process.env[CORS_ORIGINS_ENV_VAR] = `${inputFirstOrigin},,  ,`;

    const actualConfig = getCorsConfig();

    expect(actualConfig.allowedOrigins).toEqual([inputFirstOrigin]);
  });

  it('drops a wildcard origin, keeps the explicit ones and warns', () => {
    process.env[CORS_ORIGINS_ENV_VAR] = `${inputWildcardOrigin},${inputFirstOrigin}`;

    const actualConfig = getCorsConfig();

    expect(actualConfig.allowedOrigins).toEqual([inputFirstOrigin]);
    expect(actualConfig.allowedOrigins).not.toContain(inputWildcardOrigin);
    expect(Logger.prototype.warn).toHaveBeenCalled();
  });

  it('allows no origin when the only configured value is a wildcard', () => {
    process.env[CORS_ORIGINS_ENV_VAR] = inputWildcardOrigin;

    const actualConfig = getCorsConfig();

    expect(actualConfig.allowedOrigins).toEqual([]);
  });

  it('takes methods, headers and credentials from the exported constants', () => {
    process.env[CORS_ORIGINS_ENV_VAR] = inputFirstOrigin;

    const actualConfig = getCorsConfig();

    expect(actualConfig.allowedMethods).toEqual([...CORS_ALLOWED_METHODS]);
    expect(actualConfig.allowedHeaders).toEqual([...CORS_ALLOWED_HEADERS]);
    expect(actualConfig.credentials).toBe(CORS_ALLOW_CREDENTIALS);
  });

  it('returns copies of the constant arrays so callers cannot mutate them', () => {
    process.env[CORS_ORIGINS_ENV_VAR] = inputFirstOrigin;

    const actualConfig = getCorsConfig();

    expect(actualConfig.allowedMethods).not.toBe(CORS_ALLOWED_METHODS);
    expect(actualConfig.allowedHeaders).not.toBe(CORS_ALLOWED_HEADERS);
  });
});
