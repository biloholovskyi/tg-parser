import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { TelegramClient } from 'telegram';
import { FakeRedis } from '../../test/fake-redis';
import type { SessionPersistenceConfig } from '../config/redis.config';
import { SECRET_KEY_BYTES, hashSecret } from '../shared/utils/secret-cipher';
import {
  CONNECTION_LABEL,
  EXTERNAL_CALL_TIMEOUT_MS,
  SESSION_CACHE_IDLE_TTL_MS,
  SESSION_CACHE_SWEEP_INTERVAL_MS,
  SESSION_STORE_KEY_PREFIX,
  SESSION_STORE_TTL_S,
  TIMEOUT_SUFFIX,
} from './constants';
import { SessionRepository } from './session-repository';
import { SessionStore } from './session-store';
import type { TelegramClientFactory } from './telegram-client.factory';
import {
  INVALID_SESSION_MESSAGE,
  SESSION_STORAGE_UNAVAILABLE_MESSAGE,
} from './utils/telegram-errors';

// The store only needs `create`; keeping the real factory out also keeps GramJS out of this spec.
jest.mock('./telegram-client.factory', () => ({ TelegramClientFactory: class {} }));

interface MockClient {
  session: { save: jest.Mock<string, []> };
  connected: boolean;
  connect: jest.Mock<Promise<void>, []>;
  destroy: jest.Mock<Promise<void>, []>;
}

const inputSessionString = 'fake-session-store-session';
const inputOtherSessionString = 'fake-session-store-other-session';
const SWEEP_TIMER_COUNT = 1;

function buildClient(sessionString: string = inputSessionString): MockClient {
  return {
    session: { save: jest.fn(() => sessionString) },
    connected: true,
    connect: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

function asClient(client: MockClient): TelegramClient {
  return client as unknown as TelegramClient;
}

function rpcError(code: string): Error {
  return Object.assign(new Error(`RPCError: 401: ${code} (caused by fake.Call)`), {
    errorMessage: code,
  });
}

async function captureError(actualPromise: Promise<unknown>): Promise<unknown> {
  return actualPromise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('SessionStore', () => {
  let mockCreate: jest.Mock<TelegramClient, [string?]>;
  let mockLoginClient: MockClient;
  let store: SessionStore;

  beforeEach(() => {
    jest.useFakeTimers();
    mockLoginClient = buildClient();
    mockCreate = jest.fn(() => asClient(mockLoginClient));
    store = new SessionStore(
      { create: mockCreate } as unknown as TelegramClientFactory,
      new SessionRepository(null, null),
    );
  });

  afterEach(async () => {
    await store.close();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('starts exactly one idle sweep timer', () => {
      // Assert
      expect(jest.getTimerCount()).toBe(SWEEP_TIMER_COUNT);
    });

    it('evicts and destroys a client left idle past the TTL', async () => {
      // Arrange
      const mockClient = buildClient();
      await store.adopt(asClient(mockClient));

      // Act
      await jest.advanceTimersByTimeAsync(
        SESSION_CACHE_IDLE_TTL_MS + SESSION_CACHE_SWEEP_INTERVAL_MS,
      );

      // Assert
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      await expect(store.getConnected(inputSessionString)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('openLoginClient', () => {
    it('creates a client for a new login, connects it and returns it', async () => {
      // Act
      const actualClient = await store.openLoginClient();

      // Assert
      expect(actualClient).toBe(asClient(mockLoginClient));
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith();
      expect(mockLoginClient.connect).toHaveBeenCalledTimes(1);
      expect(mockLoginClient.destroy).not.toHaveBeenCalled();
    });

    it('destroys the client and rethrows the original error when connect fails', async () => {
      // Arrange
      const inputError = new Error('fake ECONNREFUSED');
      mockLoginClient.connect.mockRejectedValueOnce(inputError);

      // Act
      const actualError = await captureError(store.openLoginClient());

      // Assert
      expect(actualError).toBe(inputError);
      expect(mockLoginClient.destroy).toHaveBeenCalledTimes(1);
    });

    it('rethrows the connect error even when the teardown itself fails', async () => {
      // Arrange
      const inputError = new Error('fake ECONNRESET');
      mockLoginClient.connect.mockRejectedValueOnce(inputError);
      mockLoginClient.destroy.mockRejectedValueOnce(new Error('fake destroy failure'));

      // Act
      const actualError = await captureError(store.openLoginClient());

      // Assert
      expect(actualError).toBe(inputError);
      expect(mockLoginClient.destroy).toHaveBeenCalledTimes(1);
    });

    it('times a hanging connect out after EXTERNAL_CALL_TIMEOUT_MS and destroys the client', async () => {
      // Arrange
      mockLoginClient.connect.mockReturnValueOnce(new Promise(() => undefined));

      // Act
      const actualResult = captureError(store.openLoginClient());
      await jest.advanceTimersByTimeAsync(EXTERNAL_CALL_TIMEOUT_MS);
      const actualError = await actualResult;

      // Assert
      expect(actualError).toBeInstanceOf(Error);
      expect((actualError as Error).message).toBe(`${CONNECTION_LABEL}${TIMEOUT_SUFFIX}`);
      expect(mockLoginClient.destroy).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(SWEEP_TIMER_COUNT);
    });
  });

  describe('adopt', () => {
    it('returns the saved session string and caches the client under it', async () => {
      // Arrange
      const mockClient = buildClient();

      // Act
      const actualSessionString = await store.adopt(asClient(mockClient));
      const actualCached = await store.getConnected(inputSessionString);

      // Assert
      expect(actualSessionString).toBe(inputSessionString);
      expect(actualCached).toBe(asClient(mockClient));
      expect(mockClient.destroy).not.toHaveBeenCalled();
    });

    it('never creates a client of its own', async () => {
      // Act
      await store.adopt(asClient(buildClient()));

      // Assert
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('getConnected', () => {
    it('returns the cached client on a hit without reconnecting it', async () => {
      // Arrange
      const mockClient = buildClient();
      await store.adopt(asClient(mockClient));

      // Act
      const actualClient = await store.getConnected(inputSessionString);

      // Assert
      expect(actualClient).toBe(asClient(mockClient));
      expect(mockClient.connect).not.toHaveBeenCalled();
    });

    it('rejects an unknown session with the 401 and creates no client (miss)', async () => {
      // Act
      const actualError = await captureError(store.getConnected(inputSessionString));

      // Assert
      expect(actualError).toBeInstanceOf(UnauthorizedException);
      expect((actualError as UnauthorizedException).message).toBe(INVALID_SESSION_MESSAGE);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('trims the session string before the lookup', async () => {
      // Arrange
      const mockClient = buildClient();
      await store.adopt(asClient(mockClient));

      // Act
      const actualClient = await store.getConnected(`  ${inputSessionString}\n`);

      // Assert
      expect(actualClient).toBe(asClient(mockClient));
    });

    it('rejects a blank session string with the 401', async () => {
      // Act
      const actualError = await captureError(store.getConnected('   '));

      // Assert
      expect(actualError).toBeInstanceOf(UnauthorizedException);
    });

    it('reconnects a cached client whose socket dropped', async () => {
      // Arrange
      const mockClient = buildClient();
      await store.adopt(asClient(mockClient));
      mockClient.connected = false;

      // Act
      const actualClient = await store.getConnected(inputSessionString);

      // Assert
      expect(actualClient).toBe(asClient(mockClient));
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('propagates a failed reconnect and keeps the client cached', async () => {
      // Arrange
      const mockClient = buildClient();
      await store.adopt(asClient(mockClient));
      mockClient.connected = false;
      const inputError = new Error('fake ECONNRESET');
      mockClient.connect.mockRejectedValueOnce(inputError);

      // Act
      const actualError = await captureError(store.getConnected(inputSessionString));

      // Assert
      expect(actualError).toBe(inputError);
      expect(mockClient.destroy).not.toHaveBeenCalled();
      await expect(store.getConnected(inputSessionString)).resolves.toBe(asClient(mockClient));
    });
  });

  describe('evict', () => {
    it('destroys the cached client and forgets the session', async () => {
      // Arrange
      const mockClient = buildClient();
      await store.adopt(asClient(mockClient));

      // Act
      await store.evict(inputSessionString);

      // Assert
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      await expect(store.getConnected(inputSessionString)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('trims the session string before evicting', async () => {
      // Arrange
      const mockClient = buildClient();
      await store.adopt(asClient(mockClient));

      // Act
      await store.evict(` ${inputSessionString} `);

      // Assert
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for an unknown session', async () => {
      // Arrange
      const mockClient = buildClient();
      await store.adopt(asClient(mockClient));

      // Act
      await store.evict(inputOtherSessionString);

      // Assert
      expect(mockClient.destroy).not.toHaveBeenCalled();
      await expect(store.getConnected(inputSessionString)).resolves.toBe(asClient(mockClient));
    });
  });

  describe('evictIfSessionInvalid', () => {
    it.each([
      ['an invalid-session RPC error', rpcError('AUTH_KEY_UNREGISTERED')],
      ['an UnauthorizedException', new UnauthorizedException('fake')],
    ])('evicts and destroys the client for %s', async (_label, inputError) => {
      // Arrange
      const mockClient = buildClient();
      await store.adopt(asClient(mockClient));

      // Act
      await store.evictIfSessionInvalid(inputSessionString, inputError);

      // Assert
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      await expect(store.getConnected(inputSessionString)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it.each([
      ['a flood wait', rpcError('FLOOD_WAIT_30')],
      ['a connectivity failure', new Error('fake ECONNRESET')],
      ['a channel error', rpcError('CHANNEL_PRIVATE')],
    ])('keeps the client for %s', async (_label, inputError) => {
      // Arrange
      const mockClient = buildClient();
      await store.adopt(asClient(mockClient));

      // Act
      await store.evictIfSessionInvalid(inputSessionString, inputError);

      // Assert
      expect(mockClient.destroy).not.toHaveBeenCalled();
      await expect(store.getConnected(inputSessionString)).resolves.toBe(asClient(mockClient));
    });
  });

  describe('release', () => {
    it('destroys the client', async () => {
      // Arrange
      const mockClient = buildClient();

      // Act
      await store.release(asClient(mockClient));

      // Assert
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });

    it('swallows a failing destroy', async () => {
      // Arrange
      const mockClient = buildClient();
      mockClient.destroy.mockRejectedValueOnce(new Error('fake destroy failure'));

      // Act
      const actualResult = store.release(asClient(mockClient));

      // Assert
      await expect(actualResult).resolves.toBeUndefined();
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('close', () => {
    it('destroys every cached client and clears the sweep timer', async () => {
      // Arrange
      const mockFirstClient = buildClient(inputSessionString);
      const mockSecondClient = buildClient(inputOtherSessionString);
      await store.adopt(asClient(mockFirstClient));
      await store.adopt(asClient(mockSecondClient));

      // Act
      await store.close();

      // Assert
      expect(mockFirstClient.destroy).toHaveBeenCalledTimes(1);
      expect(mockSecondClient.destroy).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      await expect(store.getConnected(inputSessionString)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('with a persisted SessionRepository (fake Redis)', () => {
    const inputKey = Buffer.alloc(SECRET_KEY_BYTES, 9);
    const inputOtherKey = Buffer.alloc(SECRET_KEY_BYTES, 4);
    const inputConfig: SessionPersistenceConfig = {
      redisUrl: 'redis://fake-redis.invalid:6379',
      encryptionKey: inputKey,
    };
    const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;

    let fakeRedis: FakeRedis;
    let repository: SessionRepository;
    let persistedStore: SessionStore;
    let mockRestoredClients: MockClient[];
    const extraStores: SessionStore[] = [];

    function buildPersistedStore(key: Buffer = inputKey): SessionStore {
      const builtStore = new SessionStore(
        { create: mockCreate } as unknown as TelegramClientFactory,
        new SessionRepository(fakeRedis.asRedis(), { ...inputConfig, encryptionKey: key }),
      );
      extraStores.push(builtStore);
      return builtStore;
    }

    function recordKey(sessionString: string = inputSessionString): string {
      return SESSION_STORE_KEY_PREFIX + hashSecret(sessionString);
    }

    function deferred(): { promise: Promise<void>; resolve: () => void } {
      let resolve: () => void = () => undefined;
      const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
      });
      return { promise, resolve };
    }

    beforeEach(() => {
      fakeRedis = new FakeRedis();
      repository = new SessionRepository(fakeRedis.asRedis(), inputConfig);
      mockRestoredClients = [];
      mockCreate.mockImplementation((sessionString?: string) => {
        const mockClient = buildClient(sessionString);
        mockRestoredClients.push(mockClient);
        return asClient(mockClient);
      });
      persistedStore = new SessionStore(
        { create: mockCreate } as unknown as TelegramClientFactory,
        repository,
      );
    });

    afterEach(async () => {
      await persistedStore.close();
      for (const extraStore of extraStores.splice(0)) {
        await extraStore.close();
      }
      jest.restoreAllMocks();
    });

    describe('adopt', () => {
      it('persists the session so the repository knows it', async () => {
        // Act
        const actualSessionString = await persistedStore.adopt(asClient(buildClient()));

        // Assert
        expect(actualSessionString).toBe(inputSessionString);
        expect(fakeRedis.values.has(recordKey())).toBe(true);
        expect(fakeRedis.ttls.get(recordKey())).toBe(SESSION_STORE_TTL_S);
        expect(await repository.isKnown(inputSessionString)).toBe(true);
      });

      it('still returns the session and caches the client when the save fails, with one warning', async () => {
        // Arrange
        const mockWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const mockClient = buildClient();
        fakeRedis.failNext(new Error('fake ECONNREFUSED'));

        // Act
        const actualSessionString = await persistedStore.adopt(asClient(mockClient));

        // Assert
        expect(actualSessionString).toBe(inputSessionString);
        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(String(mockWarn.mock.calls[0][0])).toMatch(/^Session not persisted/);
        expect(fakeRedis.values.size).toBe(0);
        await expect(persistedStore.getConnected(inputSessionString)).resolves.toBe(
          asClient(mockClient),
        );
        expect(mockClient.destroy).not.toHaveBeenCalled();
      });
    });

    describe('getConnected on a cache miss', () => {
      it('restores a stored session: creates the client from the string, connects and caches it', async () => {
        // Arrange
        await repository.save(inputSessionString);

        // Act
        const actualClient = await persistedStore.getConnected(inputSessionString);
        const actualSecond = await persistedStore.getConnected(inputSessionString);

        // Assert
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockCreate).toHaveBeenCalledWith(inputSessionString);
        expect(actualClient).toBe(asClient(mockRestoredClients[0]));
        expect(actualSecond).toBe(actualClient);
        expect(mockRestoredClients[0].connect).toHaveBeenCalledTimes(1);
      });

      it('trims the session string before the lookup and the restore', async () => {
        // Arrange
        await repository.save(inputSessionString);

        // Act
        await persistedStore.getConnected(`  ${inputSessionString}\n`);

        // Assert
        expect(mockCreate).toHaveBeenCalledWith(inputSessionString);
      });

      it('rejects a session with no record with the 401 and creates no client', async () => {
        // Act
        const actualError = await captureError(persistedStore.getConnected(inputSessionString));

        // Assert
        expect(actualError).toBeInstanceOf(UnauthorizedException);
        expect((actualError as UnauthorizedException).message).toBe(INVALID_SESSION_MESSAGE);
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it('shares one restore between concurrent misses for the same session', async () => {
        // Arrange
        await repository.save(inputSessionString);
        const gate = deferred();
        mockCreate.mockImplementationOnce((sessionString?: string) => {
          const mockClient = buildClient(sessionString);
          mockClient.connect.mockReturnValueOnce(gate.promise);
          mockRestoredClients.push(mockClient);
          return asClient(mockClient);
        });

        // Act
        const actualFirst = persistedStore.getConnected(inputSessionString);
        await jest.advanceTimersByTimeAsync(0);
        const actualSecond = persistedStore.getConnected(inputSessionString);
        await jest.advanceTimersByTimeAsync(0);
        gate.resolve();
        const actualClients = await Promise.all([actualFirst, actualSecond]);

        // Assert
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(actualClients[0]).toBe(actualClients[1]);
        expect(mockRestoredClients[0].connect).toHaveBeenCalledTimes(1);
      });

      it('releases the restored client and rethrows when connect fails, then retries on the next call', async () => {
        // Arrange
        await repository.save(inputSessionString);
        const inputError = new Error('fake ECONNREFUSED');
        mockCreate.mockImplementationOnce((sessionString?: string) => {
          const mockClient = buildClient(sessionString);
          mockClient.connect.mockRejectedValueOnce(inputError);
          mockRestoredClients.push(mockClient);
          return asClient(mockClient);
        });

        // Act
        const actualError = await captureError(persistedStore.getConnected(inputSessionString));
        const actualRetry = await persistedStore.getConnected(inputSessionString);

        // Assert
        expect(actualError).toBe(inputError);
        expect(mockRestoredClients[0].destroy).toHaveBeenCalledTimes(1);
        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(actualRetry).toBe(asClient(mockRestoredClients[1]));
        expect(mockRestoredClients[1].destroy).not.toHaveBeenCalled();
      });

      it('releases the restored client when connect hangs past EXTERNAL_CALL_TIMEOUT_MS', async () => {
        // Arrange
        await repository.save(inputSessionString);
        mockCreate.mockImplementationOnce((sessionString?: string) => {
          const mockClient = buildClient(sessionString);
          mockClient.connect.mockReturnValueOnce(new Promise(() => undefined));
          mockRestoredClients.push(mockClient);
          return asClient(mockClient);
        });

        // Act
        const actualResult = captureError(persistedStore.getConnected(inputSessionString));
        await jest.advanceTimersByTimeAsync(EXTERNAL_CALL_TIMEOUT_MS);
        const actualError = await actualResult;

        // Assert
        expect((actualError as Error).message).toBe(`${CONNECTION_LABEL}${TIMEOUT_SUFFIX}`);
        expect(mockRestoredClients[0].destroy).toHaveBeenCalledTimes(1);
      });

      it('answers 503 when Redis is down, and creates no client', async () => {
        // Arrange
        await repository.save(inputSessionString);
        fakeRedis.failAll(new Error('fake ECONNREFUSED'));

        // Act
        const actualError = await captureError(persistedStore.getConnected(inputSessionString));

        // Assert
        expect(actualError).toBeInstanceOf(ServiceUnavailableException);
        expect((actualError as ServiceUnavailableException).message).toBe(
          SESSION_STORAGE_UNAVAILABLE_MESSAGE,
        );
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it('answers 401 and deletes the record when it was encrypted under another key', async () => {
        // Arrange
        await new SessionRepository(fakeRedis.asRedis(), {
          ...inputConfig,
          encryptionKey: inputOtherKey,
        }).save(inputSessionString);

        // Act
        const actualError = await captureError(persistedStore.getConnected(inputSessionString));

        // Assert
        expect(actualError).toBeInstanceOf(UnauthorizedException);
        expect(fakeRedis.values.has(recordKey())).toBe(false);
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it('restores a session whose client was dropped by the idle sweep (the sweep keeps the record)', async () => {
        // Arrange
        const mockAdopted = buildClient();
        await persistedStore.adopt(asClient(mockAdopted));
        await jest.advanceTimersByTimeAsync(
          SESSION_CACHE_IDLE_TTL_MS + SESSION_CACHE_SWEEP_INTERVAL_MS,
        );

        // Act
        const actualClient = await persistedStore.getConnected(inputSessionString);

        // Assert
        expect(mockAdopted.destroy).toHaveBeenCalledTimes(1);
        expect(fakeRedis.values.has(recordKey())).toBe(true);
        expect(mockCreate).toHaveBeenCalledWith(inputSessionString);
        expect(actualClient).toBe(asClient(mockRestoredClients[0]));
      });
    });

    describe('getConnected on a cache hit', () => {
      it('extends the stored record in the background', async () => {
        // Arrange
        await persistedStore.adopt(asClient(buildClient()));
        fakeRedis.ttls.set(recordKey(), 1);
        fakeRedis.calls.length = 0;

        // Act
        await persistedStore.getConnected(inputSessionString);
        await jest.advanceTimersByTimeAsync(0);

        // Assert
        expect(fakeRedis.calls).toEqual([
          { command: 'expire', args: [recordKey(), SESSION_STORE_TTL_S] },
        ]);
        expect(fakeRedis.ttls.get(recordKey())).toBe(SESSION_STORE_TTL_S);
      });

      it('does not wait for the touch to finish', async () => {
        // Arrange
        const mockClient = buildClient();
        await persistedStore.adopt(asClient(mockClient));
        const mockTouch = jest
          .spyOn(repository, 'touch')
          .mockReturnValue(new Promise<void>(() => undefined));

        // Act
        const actualClient = await persistedStore.getConnected(inputSessionString);

        // Assert
        expect(actualClient).toBe(asClient(mockClient));
        expect(mockTouch).toHaveBeenCalledWith(inputSessionString);
      });

      it('swallows a touch rejection and keeps serving the cached client while Redis is down', async () => {
        // Arrange
        const mockClient = buildClient();
        await persistedStore.adopt(asClient(mockClient));
        const inputRejectedTouch = Promise.reject(new Error('fake ECONNREFUSED'));
        const mockCatch = jest.spyOn(inputRejectedTouch, 'catch');
        jest.spyOn(repository, 'touch').mockReturnValueOnce(inputRejectedTouch);
        fakeRedis.failAll();

        // Act
        const actualFirst = await persistedStore.getConnected(inputSessionString);
        const actualSecond = await persistedStore.getConnected(inputSessionString);
        await jest.advanceTimersByTimeAsync(0);

        // Assert
        expect(actualFirst).toBe(asClient(mockClient));
        expect(actualSecond).toBe(asClient(mockClient));
        expect(mockCatch).toHaveBeenCalledTimes(1);
        expect(mockCreate).not.toHaveBeenCalled();
      });
    });

    describe('evictIfSessionInvalid', () => {
      it('evicts the client and removes the stored record for a rejected session', async () => {
        // Arrange
        const mockClient = buildClient();
        await persistedStore.adopt(asClient(mockClient));

        // Act
        await persistedStore.evictIfSessionInvalid(
          ` ${inputSessionString} `,
          rpcError('AUTH_KEY_UNREGISTERED'),
        );

        // Assert
        expect(mockClient.destroy).toHaveBeenCalledTimes(1);
        expect(fakeRedis.values.has(recordKey())).toBe(false);
        const actualError = await captureError(persistedStore.getConnected(inputSessionString));
        expect(actualError).toBeInstanceOf(UnauthorizedException);
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it('keeps the stored record for an error that is not a verdict on the session', async () => {
        // Arrange
        await persistedStore.adopt(asClient(buildClient()));

        // Act
        await persistedStore.evictIfSessionInvalid(inputSessionString, rpcError('FLOOD_WAIT_30'));

        // Assert
        expect(fakeRedis.values.has(recordKey())).toBe(true);
      });

      it('keeps the stored record on a plain evict', async () => {
        // Arrange
        await persistedStore.adopt(asClient(buildClient()));

        // Act
        await persistedStore.evict(inputSessionString);

        // Assert
        expect(fakeRedis.values.has(recordKey())).toBe(true);
      });
    });

    describe('restart (acceptance)', () => {
      it('serves a session adopted before the restart from a new store sharing Redis and the key', async () => {
        // Arrange
        const mockAdopted = buildClient();
        const inputIssued = await persistedStore.adopt(asClient(mockAdopted));
        await persistedStore.close();
        const restartedStore = buildPersistedStore();

        // Act
        const actualClient = await restartedStore.getConnected(inputIssued);

        // Assert
        expect(mockAdopted.destroy).toHaveBeenCalledTimes(1);
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockCreate).toHaveBeenCalledWith(inputSessionString);
        expect(actualClient).toBe(asClient(mockRestoredClients[0]));
        expect(mockRestoredClients[0].connect).toHaveBeenCalledTimes(1);
      });

      it('answers 401 after a restart with a changed key and drops the unreadable record', async () => {
        // Arrange
        await persistedStore.adopt(asClient(buildClient()));
        await persistedStore.close();
        const restartedStore = buildPersistedStore(inputOtherKey);

        // Act
        const actualError = await captureError(restartedStore.getConnected(inputSessionString));

        // Assert
        expect(actualError).toBeInstanceOf(UnauthorizedException);
        expect(fakeRedis.values.has(recordKey())).toBe(false);
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it('answers 401 after a restart in memory-only mode, as before', async () => {
        // Arrange
        const memoryStore = new SessionStore(
          { create: mockCreate } as unknown as TelegramClientFactory,
          new SessionRepository(null, null),
        );
        extraStores.push(memoryStore);
        await memoryStore.adopt(asClient(buildClient()));
        await memoryStore.close();
        const restartedStore = new SessionStore(
          { create: mockCreate } as unknown as TelegramClientFactory,
          new SessionRepository(null, null),
        );
        extraStores.push(restartedStore);

        // Act
        const actualError = await captureError(restartedStore.getConnected(inputSessionString));

        // Assert
        expect(actualError).toBeInstanceOf(UnauthorizedException);
        expect(mockCreate).not.toHaveBeenCalled();
      });
    });

    describe('secret hygiene', () => {
      it('never logs the session string or the key and never puts the string in a Redis key or value', async () => {
        // Arrange
        const mockSpies = LOGGER_LEVELS.map((level) =>
          jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
        );

        // Act: adopt, save failure, hit, restart restore, Redis-down miss, invalid eviction
        await persistedStore.adopt(asClient(buildClient()));
        fakeRedis.failNext();
        await persistedStore.adopt(asClient(buildClient(inputOtherSessionString)));
        await persistedStore.getConnected(inputSessionString);
        await persistedStore.close();
        const restartedStore = buildPersistedStore();
        await restartedStore.getConnected(inputSessionString);
        fakeRedis.failAll();
        await captureError(restartedStore.getConnected(inputOtherSessionString));
        fakeRedis.recover();
        await restartedStore.evictIfSessionInvalid(
          inputSessionString,
          rpcError('AUTH_KEY_UNREGISTERED'),
        );
        await jest.advanceTimersByTimeAsync(0);

        // Assert
        const actualLogged = mockSpies
          .flatMap((spy) => spy.mock.calls.flat())
          .map((argument) => String(argument))
          .join(' | ');
        expect(actualLogged).not.toContain(inputSessionString);
        expect(actualLogged).not.toContain(inputOtherSessionString);
        expect(actualLogged).not.toContain(inputKey.toString('base64'));
        expect(fakeRedis.calls.length).toBeGreaterThan(0);
        for (const call of fakeRedis.calls) {
          for (const argument of call.args) {
            expect(String(argument)).not.toContain(inputSessionString);
            expect(String(argument)).not.toContain(inputOtherSessionString);
          }
        }
      });
    });
  });
});
