import { Logger } from '@nestjs/common';
import {
  CONNECTION_RETRIES_COUNT,
  FLOOD_SLEEP_THRESHOLD_S,
  REQUEST_RETRIES_COUNT,
  RETRY_DELAY_MS,
} from './constants';
import { TelegramClientFactory } from './telegram-client.factory';

interface MockCreatedClient {
  constructorArgs: unknown[];
  connect: jest.Mock;
}

const mockCreatedClients: MockCreatedClient[] = [];
const mockFakeConfig = { apiId: 1, apiHash: 'fake-api-hash' };
let mockActiveConfig: { apiId: number; apiHash: string } = { ...mockFakeConfig };
let mockConfigError: Error | undefined;

jest.mock('telegram', () => ({
  TelegramClient: class {
    constructorArgs: unknown[];
    connect = jest.fn();

    constructor(...args: unknown[]) {
      this.constructorArgs = args;
      mockCreatedClients.push(this as unknown as MockCreatedClient);
    }
  },
}));

jest.mock('telegram/sessions', () => ({
  StringSession: class {
    constructor(readonly initial: string) {}
  },
}));

jest.mock('telegram/extensions/Logger', () => ({
  Logger: class {
    constructor(readonly level?: string) {}
  },
  LogLevel: { NONE: 'none', ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug' },
}));

jest.mock('../config/telegram.config', () => ({
  getTelegramConfig: () => {
    if (mockConfigError) {
      throw mockConfigError;
    }
    return { ...mockActiveConfig };
  },
}));

const { Logger: MockGramLogger, LogLevel: mockLogLevel } = jest.requireMock<{
  Logger: new (level?: string) => { level?: string };
  LogLevel: { ERROR: string };
}>('telegram/extensions/Logger');

const { StringSession: MockStringSession } = jest.requireMock<{
  StringSession: new (initial: string) => { initial: string };
}>('telegram/sessions');

const inputSessionString = 'fake-factory-session';

function onlyCreatedClient(): MockCreatedClient {
  expect(mockCreatedClients).toHaveLength(1);
  return mockCreatedClients[0];
}

describe('TelegramClientFactory', () => {
  let mockWarn: jest.SpyInstance;

  beforeEach(() => {
    mockCreatedClients.length = 0;
    mockActiveConfig = { ...mockFakeConfig };
    mockConfigError = undefined;
    mockWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('loads the credentials from the config loader without creating a client', () => {
      // Act
      const factory = new TelegramClientFactory();

      // Assert
      expect(factory.credentials).toEqual(mockFakeConfig);
      expect(mockCreatedClients).toHaveLength(0);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('survives a throwing config loader, warns once and keeps empty credentials', () => {
      // Arrange
      mockConfigError = new Error('fake config loader failure');

      // Act
      const factory = new TelegramClientFactory();

      // Assert
      expect(factory.credentials).toEqual({ apiId: 0, apiHash: '' });
      expect(factory.hasCredentials).toBe(false);
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(mockWarn).toHaveBeenCalledWith(
        'Config not loaded, will fail on first use: Error: fake config loader failure',
      );
    });
  });

  describe('hasCredentials', () => {
    it.each([
      ['both values are set', mockFakeConfig, true],
      ['TELEGRAM_API_ID is missing', { apiId: 0, apiHash: mockFakeConfig.apiHash }, false],
      ['TELEGRAM_API_HASH is missing', { apiId: mockFakeConfig.apiId, apiHash: '' }, false],
      ['both are missing', { apiId: 0, apiHash: '' }, false],
    ])('reflects the loaded config when %s', (_label, inputConfig, expectedResult) => {
      // Arrange
      mockActiveConfig = { ...inputConfig };

      // Act
      const actualResult = new TelegramClientFactory().hasCredentials;

      // Assert
      expect(actualResult).toBe(expectedResult);
    });
  });

  describe('create', () => {
    it('passes explicit GramJS options from named constants and the loaded credentials', () => {
      // Arrange
      const factory = new TelegramClientFactory();
      const expectedOptions = {
        floodSleepThreshold: FLOOD_SLEEP_THRESHOLD_S,
        connectionRetries: CONNECTION_RETRIES_COUNT,
        requestRetries: REQUEST_RETRIES_COUNT,
        retryDelay: RETRY_DELAY_MS,
        autoReconnect: true,
        baseLogger: expect.any(MockGramLogger),
      };

      // Act
      factory.create(inputSessionString);

      // Assert
      const [, actualApiId, actualApiHash, actualOptions] = onlyCreatedClient().constructorArgs;
      expect(actualApiId).toBe(mockFakeConfig.apiId);
      expect(actualApiHash).toBe(mockFakeConfig.apiHash);
      expect(actualOptions).toEqual(expectedOptions);
    });

    it('gives GramJS its own logger capped at the ERROR level', () => {
      // Act
      new TelegramClientFactory().create();

      // Assert
      const [, , , actualOptions] = onlyCreatedClient().constructorArgs as [
        unknown,
        unknown,
        unknown,
        { baseLogger: { level?: string } },
      ];
      expect(actualOptions.baseLogger.level).toBe(mockLogLevel.ERROR);
    });

    it('wraps the given session string in a StringSession', () => {
      // Act
      new TelegramClientFactory().create(inputSessionString);

      // Assert
      const [actualSession] = onlyCreatedClient().constructorArgs;
      expect(actualSession).toBeInstanceOf(MockStringSession);
      expect((actualSession as { initial: string }).initial).toBe(inputSessionString);
    });

    it('starts an empty session for a new login when no session string is given', () => {
      // Act
      new TelegramClientFactory().create();

      // Assert
      const [actualSession] = onlyCreatedClient().constructorArgs as [{ initial: string }];
      expect(actualSession.initial).toBe('');
    });

    it('returns a new, unconnected client on every call', () => {
      // Arrange
      const factory = new TelegramClientFactory();

      // Act
      const actualFirst = factory.create();
      const actualSecond = factory.create();

      // Assert
      expect(actualFirst).not.toBe(actualSecond);
      for (const mockClient of mockCreatedClients) {
        expect(mockClient.connect).not.toHaveBeenCalled();
      }
    });

    it('builds a client with the empty credentials when the config was not loaded', () => {
      // Arrange
      mockConfigError = new Error('fake config loader failure');
      const factory = new TelegramClientFactory();

      // Act
      factory.create();

      // Assert
      const [, actualApiId, actualApiHash] = onlyCreatedClient().constructorArgs;
      expect(actualApiId).toBe(0);
      expect(actualApiHash).toBe('');
    });
  });
});
