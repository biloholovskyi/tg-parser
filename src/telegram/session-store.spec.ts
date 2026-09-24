import { UnauthorizedException } from '@nestjs/common';
import type { TelegramClient } from 'telegram';
import {
  CONNECTION_LABEL,
  EXTERNAL_CALL_TIMEOUT_MS,
  SESSION_CACHE_IDLE_TTL_MS,
  SESSION_CACHE_SWEEP_INTERVAL_MS,
  TIMEOUT_SUFFIX,
} from './constants';
import { SessionStore } from './session-store';
import type { TelegramClientFactory } from './telegram-client.factory';
import { INVALID_SESSION_MESSAGE } from './utils/telegram-errors';

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
    store = new SessionStore({ create: mockCreate } as unknown as TelegramClientFactory);
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
});
