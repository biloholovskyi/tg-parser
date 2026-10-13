import { Logger } from '@nestjs/common';
import {
  ALERTS_API_KEY_ENV_VAR,
  ALERTS_SERVICE_NAME_DEFAULT,
  ALERTS_SERVICE_NAME_ENV_VAR,
  ALERTS_URL_ENV_VAR,
  ALERT_SERVICE_NAME_MAX_CHARS,
  getAlertsConfig,
} from './alerts.config';

const INPUT_URL = 'https://alerts.example.test';
const INPUT_API_KEY = 'test-alert-key';
const ENV_VARS = [ALERTS_URL_ENV_VAR, ALERTS_API_KEY_ENV_VAR, ALERTS_SERVICE_NAME_ENV_VAR];

describe('getAlertsConfig', () => {
  const originalEnv = new Map(ENV_VARS.map((name) => [name, process.env[name]]));
  let mockWarn: jest.SpyInstance;

  function warnedText(): string {
    return mockWarn.mock.calls.flat().map(String).join(' | ');
  }

  beforeEach(() => {
    ENV_VARS.forEach((name) => delete process.env[name]);
    mockWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    originalEnv.forEach((value, name) => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    });
  });

  it('is enabled with a valid URL and an API key, without a warning', () => {
    // Arrange
    process.env[ALERTS_URL_ENV_VAR] = INPUT_URL;
    process.env[ALERTS_API_KEY_ENV_VAR] = INPUT_API_KEY;

    // Act
    const actualConfig = getAlertsConfig();

    // Assert
    expect(actualConfig).toEqual({
      url: INPUT_URL,
      apiKey: INPUT_API_KEY,
      serviceName: ALERTS_SERVICE_NAME_DEFAULT,
      isEnabled: true,
    });
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it.each([
    ['localhost', 'http://localhost:8080'],
    ['the IPv4 loopback', 'http://127.0.0.1:8080'],
    ['the IPv6 loopback', 'http://[::1]:8080'],
    ['a Railway private host', 'http://tech-admin.railway.internal:8080'],
  ])('accepts a plain http URL to %s', (_label, inputUrl) => {
    // Arrange
    process.env[ALERTS_URL_ENV_VAR] = inputUrl;
    process.env[ALERTS_API_KEY_ENV_VAR] = INPUT_API_KEY;

    // Act
    const actualConfig = getAlertsConfig();

    // Assert
    expect(actualConfig.isEnabled).toBe(true);
    expect(actualConfig.url).toBe(inputUrl);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('accepts an https URL with a path and a port', () => {
    // Arrange
    const inputUrl = 'https://alerts.example.test:8443/api';
    process.env[ALERTS_URL_ENV_VAR] = inputUrl;
    process.env[ALERTS_API_KEY_ENV_VAR] = INPUT_API_KEY;

    // Act
    const actualConfig = getAlertsConfig();

    // Assert
    expect(actualConfig.isEnabled).toBe(true);
    expect(actualConfig.url).toBe(inputUrl);
  });

  it('strips trailing slashes and surrounding whitespace from the URL', () => {
    // Arrange
    process.env[ALERTS_URL_ENV_VAR] = `  ${INPUT_URL}///  `;
    process.env[ALERTS_API_KEY_ENV_VAR] = INPUT_API_KEY;

    // Act
    const actualConfig = getAlertsConfig();

    // Assert
    expect(actualConfig.url).toBe(INPUT_URL);
    expect(actualConfig.isEnabled).toBe(true);
  });

  it('is disabled with one warning naming ALERTS_URL when the URL is missing', () => {
    // Arrange
    process.env[ALERTS_API_KEY_ENV_VAR] = INPUT_API_KEY;

    // Act
    const actualConfig = getAlertsConfig();

    // Assert
    expect(actualConfig.isEnabled).toBe(false);
    expect(actualConfig.url).toBe('');
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(warnedText()).toContain(ALERTS_URL_ENV_VAR);
    expect(warnedText()).not.toContain(ALERTS_API_KEY_ENV_VAR);
    expect(warnedText()).not.toContain(INPUT_API_KEY);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
  ])(
    'is disabled with one warning naming ALERTS_API_KEY when the key is %s',
    (_label, inputKey) => {
      // Arrange
      process.env[ALERTS_URL_ENV_VAR] = INPUT_URL;
      if (inputKey !== undefined) {
        process.env[ALERTS_API_KEY_ENV_VAR] = inputKey;
      }

      // Act
      const actualConfig = getAlertsConfig();

      // Assert
      expect(actualConfig.isEnabled).toBe(false);
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(warnedText()).toContain(ALERTS_API_KEY_ENV_VAR);
      expect(warnedText()).not.toContain(INPUT_URL);
    },
  );

  it.each([
    ['ftp scheme', 'ftp://alerts.example.test'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['malformed', 'not a url'],
    ['relative path', '/alerts'],
    ['plain http to a public host', 'http://alerts.example.test:8080'],
    ['plain http to a look-alike private host', 'http://alerts.railway.internal.example.test'],
    ['plain http to the bare private suffix', 'http://railway.internal'],
    ['https with a username and password', 'https://fake-user:fake-pass@alerts.example.test'],
    ['https with a username only', 'https://fake-user@alerts.example.test'],
    ['https with a query', 'https://alerts.example.test/?token=fake-token'],
    ['https with a fragment', 'https://alerts.example.test/#fake-fragment'],
    ['localhost with credentials', 'http://fake-user:fake-pass@localhost:8080'],
  ])('is disabled when the URL is %s, never logging the value', (_label, inputUrl) => {
    // Arrange
    process.env[ALERTS_URL_ENV_VAR] = inputUrl;
    process.env[ALERTS_API_KEY_ENV_VAR] = INPUT_API_KEY;

    // Act
    const actualConfig = getAlertsConfig();

    // Assert
    expect(actualConfig.isEnabled).toBe(false);
    expect(actualConfig.url).toBe('');
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(warnedText()).toContain(ALERTS_URL_ENV_VAR);
    expect(warnedText()).not.toContain(inputUrl);
    expect(warnedText()).not.toContain(INPUT_API_KEY);
  });

  it('names both variables in one warning when both are missing', () => {
    // Arrange: environment already cleared

    // Act
    const actualConfig = getAlertsConfig();

    // Assert
    expect(actualConfig.isEnabled).toBe(false);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(warnedText()).toContain(ALERTS_URL_ENV_VAR);
    expect(warnedText()).toContain(ALERTS_API_KEY_ENV_VAR);
  });

  it('uses ALERTS_SERVICE_NAME when it is set', () => {
    // Arrange
    const expectedName = 'fake-service';
    process.env[ALERTS_SERVICE_NAME_ENV_VAR] = ` ${expectedName} `;

    // Act
    const actualConfig = getAlertsConfig();

    // Assert
    expect(actualConfig.serviceName).toBe(expectedName);
  });

  it('cuts a long service name to ALERT_SERVICE_NAME_MAX_CHARS', () => {
    // Arrange
    process.env[ALERTS_SERVICE_NAME_ENV_VAR] = 's'.repeat(ALERT_SERVICE_NAME_MAX_CHARS + 1);

    // Act
    const actualConfig = getAlertsConfig();

    // Assert
    expect(actualConfig.serviceName).toBe('s'.repeat(ALERT_SERVICE_NAME_MAX_CHARS));
  });

  it('falls back to the default name when ALERTS_SERVICE_NAME is blank', () => {
    // Arrange
    process.env[ALERTS_SERVICE_NAME_ENV_VAR] = '   ';

    // Act
    const actualConfig = getAlertsConfig();

    // Assert
    expect(actualConfig.serviceName).toBe(ALERTS_SERVICE_NAME_DEFAULT);
  });
});
