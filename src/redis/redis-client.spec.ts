import { Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import type Redis from 'ioredis';
import { closeRedisClient, createRedisClient, reconnectDelayMs } from './redis-client';
import {
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_CONNECT_TIMEOUT_MS,
  REDIS_MAX_RETRIES,
  REDIS_RECONNECT_MAX_DELAY_MS,
  REDIS_RECONNECT_STEP_MS,
} from './redis.constants';

interface MockRedisOptions {
  family: number;
  connectTimeout: number;
  commandTimeout: number;
  maxRetriesPerRequest: number;
  retryStrategy: (attempt: number) => number;
}

interface MockRedisInstance extends EventEmitter {
  constructorArgs: [string, MockRedisOptions];
  status: string;
  quit: jest.Mock<Promise<string>, []>;
  disconnect: jest.Mock<void, []>;
}

const mockCreatedRedis: MockRedisInstance[] = [];

jest.mock('ioredis', () => {
  // Required inside the factory: jest.mock is hoisted above the imports.
  const { EventEmitter: MockEmitter } = jest.requireActual<typeof import('events')>('events');
  class MockRedis extends MockEmitter {
    constructorArgs: unknown[];
    status = 'wait';
    quit = jest.fn().mockResolvedValue('OK');
    disconnect = jest.fn();

    constructor(...args: unknown[]) {
      super();
      this.constructorArgs = args;
      mockCreatedRedis.push(this as unknown as MockRedisInstance);
    }
  }
  return { __esModule: true, default: MockRedis };
});

const inputRedisUrl = 'redis://fake-user:fake-password@fake-redis.invalid:6379';
const IP_FAMILY_ANY = 0;
const OUTAGE_ERROR_COUNT = 3;

function connectionError(code: string): Error & { code: string } {
  return Object.assign(new Error(`connect ${code} fake-redis.invalid`), { code });
}

function asRedis(mock: MockRedisInstance): Redis {
  return mock as unknown as Redis;
}

describe('redis-client', () => {
  let mockLog: jest.SpyInstance;
  let mockError: jest.SpyInstance;
  let mockWarn: jest.SpyInstance;

  beforeEach(() => {
    mockCreatedRedis.length = 0;
    mockLog = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    mockError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function loggedText(): string {
    return [mockLog, mockError, mockWarn]
      .flatMap((spy) => spy.mock.calls.flat())
      .map((argument) => String(argument))
      .join(' | ');
  }

  describe('reconnectDelayMs', () => {
    it('grows by REDIS_RECONNECT_STEP_MS per attempt', () => {
      // Act
      const actualFirst = reconnectDelayMs(1);
      const actualSecond = reconnectDelayMs(2);

      // Assert
      expect(actualFirst).toBe(REDIS_RECONNECT_STEP_MS);
      expect(actualSecond).toBe(2 * REDIS_RECONNECT_STEP_MS);
    });

    it('is capped at REDIS_RECONNECT_MAX_DELAY_MS and never gives up (always a number)', () => {
      // Arrange
      const inputAttemptAtCeiling = REDIS_RECONNECT_MAX_DELAY_MS / REDIS_RECONNECT_STEP_MS;
      const inputHugeAttempt = Number.MAX_SAFE_INTEGER;

      // Act
      const actualAtCeiling = reconnectDelayMs(inputAttemptAtCeiling);
      const actualPastCeiling = reconnectDelayMs(inputAttemptAtCeiling + 1);
      const actualHuge = reconnectDelayMs(inputHugeAttempt);

      // Assert
      expect(actualAtCeiling).toBe(REDIS_RECONNECT_MAX_DELAY_MS);
      expect(actualPastCeiling).toBe(REDIS_RECONNECT_MAX_DELAY_MS);
      expect(actualHuge).toBe(REDIS_RECONNECT_MAX_DELAY_MS);
    });
  });

  describe('createRedisClient', () => {
    it('constructs exactly one client with the URL and explicit bounds', () => {
      // Act
      const actualClient = createRedisClient(inputRedisUrl);

      // Assert
      expect(mockCreatedRedis).toHaveLength(1);
      expect(actualClient).toBe(asRedis(mockCreatedRedis[0]));
      const [actualUrl, actualOptions] = mockCreatedRedis[0].constructorArgs;
      expect(actualUrl).toBe(inputRedisUrl);
      expect(actualOptions).toEqual(
        expect.objectContaining({
          family: IP_FAMILY_ANY,
          connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
          commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
          maxRetriesPerRequest: REDIS_MAX_RETRIES,
        }),
      );
      expect(actualOptions.retryStrategy).toBe(reconnectDelayMs);
    });

    it('logs "Connected" on the first ready', () => {
      // Arrange
      const actualClient = createRedisClient(inputRedisUrl);

      // Act
      actualClient.emit('ready');

      // Assert
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockLog.mock.calls[0][0]).toBe('Connected');
    });

    it('logs one error per outage however many attempts fail, then "Connection restored"', () => {
      // Arrange
      const actualClient = createRedisClient(inputRedisUrl);
      actualClient.emit('ready');
      mockLog.mockClear();

      // Act
      for (let attempt = 0; attempt < OUTAGE_ERROR_COUNT; attempt += 1) {
        actualClient.emit('error', connectionError('ECONNREFUSED'));
      }
      actualClient.emit('ready');

      // Assert
      expect(mockError).toHaveBeenCalledTimes(1);
      expect(mockError.mock.calls[0][0]).toBe('Connection error (ECONNREFUSED)');
      expect(mockLog).toHaveBeenCalledTimes(1);
      expect(mockLog.mock.calls[0][0]).toBe('Connection restored');
    });

    it('logs one error again for a second outage after recovery', () => {
      // Arrange
      const actualClient = createRedisClient(inputRedisUrl);

      // Act
      actualClient.emit('error', connectionError('ECONNRESET'));
      actualClient.emit('error', connectionError('ECONNRESET'));
      actualClient.emit('ready');
      actualClient.emit('error', connectionError('ETIMEDOUT'));
      actualClient.emit('error', connectionError('ETIMEDOUT'));

      // Assert
      expect(mockError).toHaveBeenCalledTimes(2);
      expect(mockError.mock.calls[1][0]).toBe('Connection error (ETIMEDOUT)');
    });

    it('falls back to the error name when the error has no code', () => {
      // Arrange
      const actualClient = createRedisClient(inputRedisUrl);
      const inputError = new TypeError('fake failure without a code');

      // Act
      actualClient.emit('error', inputError);

      // Assert
      expect(mockError.mock.calls[0][0]).toBe('Connection error (TypeError)');
    });

    it('never logs the URL or its password', () => {
      // Arrange
      const actualClient = createRedisClient(inputRedisUrl);

      // Act
      actualClient.emit('error', connectionError('ECONNREFUSED'));
      actualClient.emit('ready');

      // Assert
      expect(loggedText()).not.toContain(inputRedisUrl);
      expect(loggedText()).not.toContain('fake-password');
    });
  });

  describe('closeRedisClient', () => {
    function buildClient(status: string): MockRedisInstance {
      createRedisClient(inputRedisUrl);
      const mockClient = mockCreatedRedis[mockCreatedRedis.length - 1];
      mockClient.status = status;
      return mockClient;
    }

    it('quits politely when the connection is ready', async () => {
      // Arrange
      const mockClient = buildClient('ready');

      // Act
      await closeRedisClient(asRedis(mockClient));

      // Assert
      expect(mockClient.quit).toHaveBeenCalledTimes(1);
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it.each(['wait', 'connecting', 'reconnecting', 'end'])(
      'disconnects at once without quit when the status is %s',
      async (inputStatus) => {
        // Arrange
        const mockClient = buildClient(inputStatus);

        // Act
        await closeRedisClient(asRedis(mockClient));

        // Assert
        expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
        expect(mockClient.quit).not.toHaveBeenCalled();
      },
    );

    it('disconnects and resolves when quit fails', async () => {
      // Arrange
      const mockClient = buildClient('ready');
      mockClient.quit.mockRejectedValueOnce(new Error('fake quit failure'));

      // Act
      const actualResult = closeRedisClient(asRedis(mockClient));

      // Assert
      await expect(actualResult).resolves.toBeUndefined();
      expect(mockClient.quit).toHaveBeenCalledTimes(1);
      expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
