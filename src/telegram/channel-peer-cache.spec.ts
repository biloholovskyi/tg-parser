import { Logger } from '@nestjs/common';
import { FakeRedis } from '../../test/fake-redis';
import { hashSecret } from '../shared/utils/secret-cipher';
import { ChannelPeerCache } from './channel-peer-cache';
import type { ChannelPeer } from './channel-peer-cache';
import {
  CHANNEL_PEER_CACHE_MAX_ENTRIES,
  CHANNEL_PEER_KEY_PREFIX,
  CHANNEL_PEER_TTL_S,
} from './constants';

const inputSession = 'fake-session-for-peer-cache';
const inputOtherSession = 'fake-other-session-for-peer-cache';
const inputUsername = 'Fake_Channel';
const inputPeer: ChannelPeer = { channelId: '1234567890123', accessHash: '-9876543210987654321' };
const inputOtherPeer: ChannelPeer = { channelId: '42', accessHash: '7' };

function expectedKeyFor(session: string, username: string): string {
  return `${CHANNEL_PEER_KEY_PREFIX}${hashSecret(session)}:${username.toLowerCase()}`;
}

function usernameAt(index: number): string {
  return `fake_channel_${index}`;
}

describe('ChannelPeerCache', () => {
  let mockWarn: jest.SpyInstance;

  beforeEach(() => {
    mockWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('memory mode (no Redis)', () => {
    let cache: ChannelPeerCache;

    beforeEach(() => {
      cache = new ChannelPeerCache(null);
    });

    it('misses for a channel never stored', async () => {
      // Act
      const actualPeer = await cache.get(inputSession, inputUsername);

      // Assert
      expect(actualPeer).toBeUndefined();
    });

    it('returns the stored peer on a hit', async () => {
      // Arrange
      await cache.set(inputSession, inputUsername, inputPeer);

      // Act
      const actualPeer = await cache.get(inputSession, inputUsername);

      // Assert
      expect(actualPeer).toEqual(inputPeer);
    });

    it('treats the username case-insensitively', async () => {
      // Arrange
      await cache.set(inputSession, inputUsername.toUpperCase(), inputPeer);

      // Act
      const actualPeer = await cache.get(inputSession, inputUsername.toLowerCase());

      // Assert
      expect(actualPeer).toEqual(inputPeer);
    });

    it('keeps peers of different sessions apart', async () => {
      // Arrange
      await cache.set(inputSession, inputUsername, inputPeer);

      // Act
      const actualPeer = await cache.get(inputOtherSession, inputUsername);

      // Assert
      expect(actualPeer).toBeUndefined();
    });

    it('overwrites an existing entry on set', async () => {
      // Arrange
      await cache.set(inputSession, inputUsername, inputPeer);

      // Act
      await cache.set(inputSession, inputUsername, inputOtherPeer);

      // Assert
      await expect(cache.get(inputSession, inputUsername)).resolves.toEqual(inputOtherPeer);
    });

    it('removes an entry', async () => {
      // Arrange
      await cache.set(inputSession, inputUsername, inputPeer);

      // Act
      await cache.remove(inputSession, inputUsername.toUpperCase());

      // Assert
      await expect(cache.get(inputSession, inputUsername)).resolves.toBeUndefined();
    });

    it('removing a missing entry is a no-op', async () => {
      // Act
      const actualResult = cache.remove(inputSession, inputUsername);

      // Assert
      await expect(actualResult).resolves.toBeUndefined();
    });

    it(`evicts the oldest entry beyond CHANNEL_PEER_CACHE_MAX_ENTRIES`, async () => {
      // Arrange
      for (let index = 0; index < CHANNEL_PEER_CACHE_MAX_ENTRIES; index += 1) {
        await cache.set(inputSession, usernameAt(index), inputPeer);
      }

      // Act
      await cache.set(inputSession, usernameAt(CHANNEL_PEER_CACHE_MAX_ENTRIES), inputPeer);

      // Assert
      await expect(cache.get(inputSession, usernameAt(0))).resolves.toBeUndefined();
      await expect(cache.get(inputSession, usernameAt(1))).resolves.toEqual(inputPeer);
      await expect(
        cache.get(inputSession, usernameAt(CHANNEL_PEER_CACHE_MAX_ENTRIES)),
      ).resolves.toEqual(inputPeer);
    });

    it('keeps a recently read entry and evicts the least recently used one instead', async () => {
      // Arrange
      for (let index = 0; index < CHANNEL_PEER_CACHE_MAX_ENTRIES; index += 1) {
        await cache.set(inputSession, usernameAt(index), inputPeer);
      }
      await cache.get(inputSession, usernameAt(0));

      // Act
      await cache.set(inputSession, usernameAt(CHANNEL_PEER_CACHE_MAX_ENTRIES), inputPeer);

      // Assert
      await expect(cache.get(inputSession, usernameAt(0))).resolves.toEqual(inputPeer);
      await expect(cache.get(inputSession, usernameAt(1))).resolves.toBeUndefined();
    });

    it('re-setting an existing entry does not evict anything', async () => {
      // Arrange
      for (let index = 0; index < CHANNEL_PEER_CACHE_MAX_ENTRIES; index += 1) {
        await cache.set(inputSession, usernameAt(index), inputPeer);
      }

      // Act
      await cache.set(inputSession, usernameAt(0), inputOtherPeer);

      // Assert
      await expect(cache.get(inputSession, usernameAt(0))).resolves.toEqual(inputOtherPeer);
      await expect(cache.get(inputSession, usernameAt(1))).resolves.toEqual(inputPeer);
    });
  });

  describe('Redis mode', () => {
    let fakeRedis: FakeRedis;
    let cache: ChannelPeerCache;

    beforeEach(() => {
      fakeRedis = new FakeRedis();
      cache = new ChannelPeerCache(fakeRedis.asRedis());
    });

    it('writes the peer as JSON with EX CHANNEL_PEER_TTL_S under a SHA-256 key', async () => {
      // Arrange
      const expectedKey = expectedKeyFor(inputSession, inputUsername);

      // Act
      await cache.set(inputSession, inputUsername, inputPeer);

      // Assert
      expect(fakeRedis.calls).toEqual([
        {
          command: 'set',
          args: [expectedKey, JSON.stringify(inputPeer), 'EX', CHANNEL_PEER_TTL_S],
        },
      ]);
      expect(JSON.parse(fakeRedis.values.get(expectedKey) ?? 'null')).toEqual(inputPeer);
    });

    it('never puts the session string into a key or a value', async () => {
      // Arrange
      await cache.set(inputSession, inputUsername, inputPeer);

      // Act
      await cache.get(inputSession, inputUsername);
      await cache.remove(inputSession, inputUsername);

      // Assert
      const actualTouched = fakeRedis.calls.flatMap((call) => call.args.map(String)).join(' ');
      expect(actualTouched).not.toContain(inputSession);
      for (const actualKey of fakeRedis.touchedKeys()) {
        expect(actualKey).toContain(hashSecret(inputSession));
      }
    });

    it('returns the stored peer on a hit and extends its TTL', async () => {
      // Arrange
      const expectedKey = expectedKeyFor(inputSession, inputUsername);
      await cache.set(inputSession, inputUsername, inputPeer);
      fakeRedis.ttls.set(expectedKey, 1);
      fakeRedis.calls.length = 0;

      // Act
      const actualPeer = await cache.get(inputSession, inputUsername.toUpperCase());

      // Assert
      expect(actualPeer).toEqual(inputPeer);
      expect(fakeRedis.calls).toEqual([
        { command: 'get', args: [expectedKey] },
        { command: 'expire', args: [expectedKey, CHANNEL_PEER_TTL_S] },
      ]);
      expect(fakeRedis.ttls.get(expectedKey)).toBe(CHANNEL_PEER_TTL_S);
    });

    it('misses without extending anything when no record exists', async () => {
      // Act
      const actualPeer = await cache.get(inputSession, inputUsername);

      // Assert
      expect(actualPeer).toBeUndefined();
      expect(fakeRedis.calls.map((call) => call.command)).toEqual(['get']);
    });

    it.each([
      ['not JSON', 'fake-not-json{'],
      ['JSON null', 'null'],
      ['a JSON number', '42'],
      ['missing accessHash', JSON.stringify({ channelId: '1' })],
      ['numeric fields', JSON.stringify({ channelId: 1, accessHash: 2 })],
      ['non-decimal channelId', JSON.stringify({ channelId: '0x1F', accessHash: '2' })],
      ['non-decimal accessHash', JSON.stringify({ channelId: '1', accessHash: '2.5' })],
      ['empty strings', JSON.stringify({ channelId: '', accessHash: '' })],
    ])('treats a stored value that is %s as a miss', async (_label, inputStored) => {
      // Arrange
      fakeRedis.values.set(expectedKeyFor(inputSession, inputUsername), inputStored);

      // Act
      const actualPeer = await cache.get(inputSession, inputUsername);

      // Assert
      expect(actualPeer).toBeUndefined();
      expect(fakeRedis.calls.map((call) => call.command)).toEqual(['get']);
    });

    it('returns only channelId and accessHash from a stored value with extra fields', async () => {
      // Arrange
      fakeRedis.values.set(
        expectedKeyFor(inputSession, inputUsername),
        JSON.stringify({ ...inputPeer, extra: 'fake-extra' }),
      );

      // Act
      const actualPeer = await cache.get(inputSession, inputUsername);

      // Assert
      expect(actualPeer).toEqual(inputPeer);
    });

    it('deletes the record on remove', async () => {
      // Arrange
      const expectedKey = expectedKeyFor(inputSession, inputUsername);
      await cache.set(inputSession, inputUsername, inputPeer);

      // Act
      await cache.remove(inputSession, inputUsername);

      // Assert
      expect(fakeRedis.values.has(expectedKey)).toBe(false);
      expect(fakeRedis.calls[fakeRedis.calls.length - 1]).toEqual({
        command: 'del',
        args: [expectedKey],
      });
    });

    it('does not touch the in-memory map when Redis is configured', async () => {
      // Arrange
      await cache.set(inputSession, inputUsername, inputPeer);
      fakeRedis.values.clear();

      // Act
      const actualPeer = await cache.get(inputSession, inputUsername);

      // Assert
      expect(actualPeer).toBeUndefined();
    });

    describe('Redis failures', () => {
      const inputFailure = Object.assign(new Error(`fake ECONNREFUSED ${inputSession}`), {
        name: 'FakeRedisError',
      });

      function expectOneSafeWarning(expectedAction: string): void {
        expect(mockWarn).toHaveBeenCalledTimes(1);
        const [actualLine] = mockWarn.mock.calls[0] as [string];
        expect(actualLine).toBe(`Channel peer cache ${expectedAction} failed: FakeRedisError`);
        expect(actualLine).not.toContain(inputSession);
        expect(actualLine).not.toContain(hashSecret(inputSession));
      }

      it('get: a failing read is a miss with one warning', async () => {
        // Arrange
        fakeRedis.failNext(inputFailure);

        // Act
        const actualPeer = await cache.get(inputSession, inputUsername);

        // Assert
        expect(actualPeer).toBeUndefined();
        expectOneSafeWarning('read');
      });

      it('get: a failing TTL extension still returns the peer with one warning', async () => {
        // Arrange
        await cache.set(inputSession, inputUsername, inputPeer);
        jest.spyOn(fakeRedis, 'expire').mockRejectedValueOnce(inputFailure);

        // Act
        const actualPeer = await cache.get(inputSession, inputUsername);

        // Assert
        expect(actualPeer).toEqual(inputPeer);
        expectOneSafeWarning('extend');
      });

      it('set: a failing write does not throw and warns once', async () => {
        // Arrange
        fakeRedis.failNext(inputFailure);

        // Act
        const actualResult = cache.set(inputSession, inputUsername, inputPeer);

        // Assert
        await expect(actualResult).resolves.toBeUndefined();
        expectOneSafeWarning('write');
      });

      it('remove: a failing delete does not throw and warns once', async () => {
        // Arrange
        fakeRedis.failNext(inputFailure);

        // Act
        const actualResult = cache.remove(inputSession, inputUsername);

        // Assert
        await expect(actualResult).resolves.toBeUndefined();
        expectOneSafeWarning('remove');
      });

      it('names a non-Error rejection as unknown', async () => {
        // Arrange
        jest.spyOn(fakeRedis, 'get').mockRejectedValueOnce(`fake raw ${inputSession}`);

        // Act
        const actualPeer = await cache.get(inputSession, inputUsername);

        // Assert
        expect(actualPeer).toBeUndefined();
        expect(mockWarn).toHaveBeenCalledWith('Channel peer cache read failed: unknown');
        expect(String(mockWarn.mock.calls.flat())).not.toContain(inputSession);
      });
    });
  });
});
