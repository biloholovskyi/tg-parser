import { Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { REDIS_URL_ENV_VAR, SESSION_ENCRYPTION_KEY_ENV_VAR } from '../config/redis.config';
import { SECRET_KEY_BYTES } from '../shared/utils/secret-cipher';
import { closeRedisClient, createRedisClient } from './redis-client';
import { REDIS_CLIENT, SESSION_PERSISTENCE_CONFIG } from './redis.constants';
import { RedisModule } from './redis.module';

jest.mock('./redis-client', () => ({
  createRedisClient: jest.fn(),
  closeRedisClient: jest.fn(),
}));

const inputRedisUrl = 'redis://fake-user:fake-password@fake-redis.invalid:6379';
const inputKeyBytes = Buffer.alloc(SECRET_KEY_BYTES, 3);
const inputKey = inputKeyBytes.toString('base64');

const shutdownOrder: string[] = [];

/** Stands in for SessionStore: a provider whose teardown must run before Redis closes. */
@Injectable()
class FakeClientOwner implements OnModuleDestroy {
  onModuleDestroy(): void {
    shutdownOrder.push('clients released');
  }
}

@Module({ imports: [RedisModule], providers: [FakeClientOwner] })
class FakeConsumerModule {}

describe('RedisModule', () => {
  const originalUrl = process.env[REDIS_URL_ENV_VAR];
  const originalKey = process.env[SESSION_ENCRYPTION_KEY_ENV_VAR];
  const mockCreateRedisClient = jest.mocked(createRedisClient);
  const mockCloseRedisClient = jest.mocked(closeRedisClient);
  const mockRedisClient = { fakeRedis: true };

  function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  beforeEach(() => {
    shutdownOrder.length = 0;
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    mockCreateRedisClient.mockReturnValue(mockRedisClient as never);
    mockCloseRedisClient.mockImplementation(async () => {
      shutdownOrder.push('redis closed');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockCreateRedisClient.mockReset();
    mockCloseRedisClient.mockReset();
    restoreEnv(REDIS_URL_ENV_VAR, originalUrl);
    restoreEnv(SESSION_ENCRYPTION_KEY_ENV_VAR, originalKey);
  });

  describe('without persistence config', () => {
    beforeEach(() => {
      process.env[REDIS_URL_ENV_VAR] = '';
      process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = '';
    });

    it('provides null for the client and the config and creates no client', async () => {
      // Arrange
      const moduleRef = await Test.createTestingModule({ imports: [RedisModule] }).compile();

      // Act
      const actualClient = moduleRef.get(REDIS_CLIENT);
      const actualConfig = moduleRef.get(SESSION_PERSISTENCE_CONFIG);
      await moduleRef.close();

      // Assert
      expect(actualClient).toBeNull();
      expect(actualConfig).toBeNull();
      expect(mockCreateRedisClient).not.toHaveBeenCalled();
    });

    it('closes nothing on shutdown', async () => {
      // Arrange
      const moduleRef = await Test.createTestingModule({ imports: [RedisModule] }).compile();

      // Act
      await moduleRef.close();

      // Assert
      expect(mockCloseRedisClient).not.toHaveBeenCalled();
    });
  });

  describe('with persistence config', () => {
    beforeEach(() => {
      process.env[REDIS_URL_ENV_VAR] = inputRedisUrl;
      process.env[SESSION_ENCRYPTION_KEY_ENV_VAR] = inputKey;
    });

    it('creates one client from the configured URL and exposes the config', async () => {
      // Arrange
      const moduleRef = await Test.createTestingModule({ imports: [RedisModule] }).compile();

      // Act
      const actualClient = moduleRef.get(REDIS_CLIENT);
      const actualConfig = moduleRef.get(SESSION_PERSISTENCE_CONFIG);
      await moduleRef.close();

      // Assert
      expect(actualClient).toBe(mockRedisClient);
      expect(mockCreateRedisClient).toHaveBeenCalledTimes(1);
      expect(mockCreateRedisClient).toHaveBeenCalledWith(inputRedisUrl);
      expect(actualConfig.redisUrl).toBe(inputRedisUrl);
      expect(actualConfig.encryptionKey.equals(inputKeyBytes)).toBe(true);
    });

    it('closes the client once on application shutdown', async () => {
      // Arrange
      const moduleRef = await Test.createTestingModule({ imports: [RedisModule] }).compile();

      // Act
      await moduleRef.close();

      // Assert
      expect(mockCloseRedisClient).toHaveBeenCalledTimes(1);
      expect(mockCloseRedisClient).toHaveBeenCalledWith(mockRedisClient);
    });

    it('closes Redis only after every onModuleDestroy has released its clients', async () => {
      // Arrange
      const moduleRef = await Test.createTestingModule({
        imports: [FakeConsumerModule],
      }).compile();

      // Act
      await moduleRef.close();

      // Assert
      expect(shutdownOrder).toEqual(['clients released', 'redis closed']);
    });
  });
});
