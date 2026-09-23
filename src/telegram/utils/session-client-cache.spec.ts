import { SessionClientCache } from './session-client-cache';
import type { ReleasableClient } from './session-client-cache';

const INPUT_MAX_ENTRIES = 3;
const INPUT_IDLE_TTL_MS = 10_000;
const INPUT_SWEEP_INTERVAL_MS = 1_000;
const INPUT_UNIQUE_SESSION_COUNT = 10;
const INPUT_HALF_TTL_MS = INPUT_IDLE_TTL_MS / 2;

interface MockClient extends ReleasableClient {
  destroy: jest.Mock<Promise<void>, []>;
}

function createMockClient(): MockClient {
  return { destroy: jest.fn<Promise<void>, []>().mockResolvedValue(undefined) };
}

describe('SessionClientCache', () => {
  let mockNowMs: number;
  let cache: SessionClientCache<MockClient>;

  beforeEach(() => {
    jest.useFakeTimers();
    mockNowMs = 0;
    cache = new SessionClientCache<MockClient>({
      maxEntries: INPUT_MAX_ENTRIES,
      idleTtlMs: INPUT_IDLE_TTL_MS,
      sweepIntervalMs: INPUT_SWEEP_INTERVAL_MS,
      now: () => mockNowMs,
    });
  });

  afterEach(async () => {
    await cache.close();
    jest.useRealTimers();
  });

  describe('get / has', () => {
    it('returns the cached client on a hit', async () => {
      // Arrange
      const mockClient = createMockClient();
      await cache.set('fake-session-a', mockClient);

      // Act
      const actualClient = cache.get('fake-session-a');

      // Assert
      expect(actualClient).toBe(mockClient);
      expect(cache.has('fake-session-a')).toBe(true);
    });

    it('returns undefined on a miss', () => {
      // Act
      const actualClient = cache.get('fake-session-missing');

      // Assert
      expect(actualClient).toBeUndefined();
      expect(cache.has('fake-session-missing')).toBe(false);
      expect(cache.size).toBe(0);
    });
  });

  describe('set', () => {
    it('evicts and destroys the least recently used client at the ceiling', async () => {
      // Arrange
      const mockClientA = createMockClient();
      const mockClientB = createMockClient();
      const mockClientC = createMockClient();
      const mockClientD = createMockClient();
      await cache.set('fake-session-a', mockClientA);
      await cache.set('fake-session-b', mockClientB);
      await cache.set('fake-session-c', mockClientC);
      cache.get('fake-session-a');

      // Act
      await cache.set('fake-session-d', mockClientD);

      // Assert
      expect(cache.size).toBe(INPUT_MAX_ENTRIES);
      expect(cache.has('fake-session-b')).toBe(false);
      expect(mockClientB.destroy).toHaveBeenCalledTimes(1);
      expect(cache.has('fake-session-a')).toBe(true);
      expect(mockClientA.destroy).not.toHaveBeenCalled();
      expect(mockClientC.destroy).not.toHaveBeenCalled();
      expect(mockClientD.destroy).not.toHaveBeenCalled();
    });

    it('never exceeds maxEntries for a stream of unique sessions', async () => {
      // Arrange
      const mockClients = Array.from({ length: INPUT_UNIQUE_SESSION_COUNT }, createMockClient);
      const actualSizes: number[] = [];

      // Act
      for (const [index, mockClient] of mockClients.entries()) {
        await cache.set(`fake-session-${index}`, mockClient);
        actualSizes.push(cache.size);
      }

      // Assert
      const expectedDestroyedCount = INPUT_UNIQUE_SESSION_COUNT - INPUT_MAX_ENTRIES;
      const actualDestroyedCount = mockClients.filter(
        (c) => c.destroy.mock.calls.length > 0,
      ).length;
      expect(Math.max(...actualSizes)).toBe(INPUT_MAX_ENTRIES);
      expect(actualDestroyedCount).toBe(expectedDestroyedCount);
    });

    it('releases a different client stored under the same key', async () => {
      // Arrange
      const mockOldClient = createMockClient();
      const mockNewClient = createMockClient();
      await cache.set('fake-session-a', mockOldClient);

      // Act
      await cache.set('fake-session-a', mockNewClient);

      // Assert
      expect(mockOldClient.destroy).toHaveBeenCalledTimes(1);
      expect(cache.get('fake-session-a')).toBe(mockNewClient);
      expect(cache.size).toBe(1);
    });

    it('does not release the client when the same client is stored again', async () => {
      // Arrange
      const mockClient = createMockClient();
      await cache.set('fake-session-a', mockClient);

      // Act
      await cache.set('fake-session-a', mockClient);

      // Assert
      expect(mockClient.destroy).not.toHaveBeenCalled();
      expect(cache.size).toBe(1);
    });

    it('does not evict another entry when re-setting an existing key at the ceiling', async () => {
      // Arrange
      const mockClients = Array.from({ length: INPUT_MAX_ENTRIES }, createMockClient);
      for (const [index, mockClient] of mockClients.entries()) {
        await cache.set(`fake-session-${index}`, mockClient);
      }

      // Act
      await cache.set('fake-session-0', mockClients[0]);

      // Assert
      expect(cache.size).toBe(INPUT_MAX_ENTRIES);
      mockClients.forEach((c) => expect(c.destroy).not.toHaveBeenCalled());
    });
  });

  describe('evict', () => {
    it('removes the entry and destroys its client', async () => {
      // Arrange
      const mockClient = createMockClient();
      await cache.set('fake-session-a', mockClient);

      // Act
      await cache.evict('fake-session-a');

      // Assert
      expect(cache.has('fake-session-a')).toBe(false);
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for an unknown key', async () => {
      // Arrange
      const mockClient = createMockClient();
      await cache.set('fake-session-a', mockClient);

      // Act
      await cache.evict('fake-session-unknown');

      // Assert
      expect(cache.size).toBe(1);
      expect(mockClient.destroy).not.toHaveBeenCalled();
    });

    it('still removes the entry when destroy rejects', async () => {
      // Arrange
      const mockClient = createMockClient();
      mockClient.destroy.mockRejectedValue(new Error('fake destroy failure'));
      await cache.set('fake-session-a', mockClient);

      // Act
      const actualEviction = cache.evict('fake-session-a');

      // Assert
      await expect(actualEviction).resolves.toBeUndefined();
      expect(cache.has('fake-session-a')).toBe(false);
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('idle sweep', () => {
    it('destroys a client idle past the TTL on the next sweep tick', async () => {
      // Arrange
      const mockClient = createMockClient();
      await cache.set('fake-session-a', mockClient);
      cache.startSweeping();
      mockNowMs = INPUT_IDLE_TTL_MS + 1;

      // Act
      await jest.advanceTimersByTimeAsync(INPUT_SWEEP_INTERVAL_MS);

      // Assert
      expect(cache.has('fake-session-a')).toBe(false);
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });

    it('keeps a client that is younger than the TTL', async () => {
      // Arrange
      const mockClient = createMockClient();
      await cache.set('fake-session-a', mockClient);
      cache.startSweeping();
      mockNowMs = INPUT_IDLE_TTL_MS - 1;

      // Act
      await jest.advanceTimersByTimeAsync(INPUT_SWEEP_INTERVAL_MS);

      // Assert
      expect(cache.has('fake-session-a')).toBe(true);
      expect(mockClient.destroy).not.toHaveBeenCalled();
    });

    it('keeps a touched entry and evicts the untouched one', async () => {
      // Arrange
      const mockTouchedClient = createMockClient();
      const mockIdleClient = createMockClient();
      await cache.set('fake-session-touched', mockTouchedClient);
      await cache.set('fake-session-idle', mockIdleClient);
      mockNowMs = INPUT_HALF_TTL_MS;
      cache.get('fake-session-touched');
      mockNowMs = INPUT_IDLE_TTL_MS + 1;

      // Act
      await cache.sweepIdle();

      // Assert
      expect(cache.has('fake-session-touched')).toBe(true);
      expect(mockTouchedClient.destroy).not.toHaveBeenCalled();
      expect(cache.has('fake-session-idle')).toBe(false);
      expect(mockIdleClient.destroy).toHaveBeenCalledTimes(1);
    });

    it('startSweeping is idempotent and registers a single interval', () => {
      // Act
      cache.startSweeping();
      cache.startSweeping();

      // Assert
      expect(jest.getTimerCount()).toBe(1);
    });
  });

  describe('close', () => {
    it('destroys every cached client and stops the sweep', async () => {
      // Arrange
      const mockClients = Array.from({ length: INPUT_MAX_ENTRIES }, createMockClient);
      for (const [index, mockClient] of mockClients.entries()) {
        await cache.set(`fake-session-${index}`, mockClient);
      }
      cache.startSweeping();

      // Act
      await cache.close();

      // Assert
      expect(cache.size).toBe(0);
      mockClients.forEach((c) => expect(c.destroy).toHaveBeenCalledTimes(1));
      expect(jest.getTimerCount()).toBe(0);
    });

    it('allows sweeping to be restarted after close', async () => {
      // Arrange
      cache.startSweeping();
      await cache.close();

      // Act
      cache.startSweeping();

      // Assert
      expect(jest.getTimerCount()).toBe(1);
    });
  });
});
