import { HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import bigInt from 'big-integer';
import type { TelegramClient } from 'telegram';
import { FakeRedis } from '../../test/fake-redis';
import type { AlertService } from '../alerts/alert.service';
import { MS_IN_SECOND } from '../shared/constants/rate-limit.constants';
import { TooManyRequestsException } from '../shared/exceptions/too-many-requests.exception';
import { hashSecret } from '../shared/utils/secret-cipher';
import { ChannelPeerCache } from './channel-peer-cache';
import type { ChannelPeer } from './channel-peer-cache';
import { ChannelService } from './channel.service';
import { CHANNEL_PEER_KEY_PREFIX, CHANNEL_PEER_STALE_ERRORS, SECONDS_IN_HOUR } from './constants';
import type { SessionStore } from './session-store';

jest.mock('telegram/tl', () => {
  class MockMessage {
    constructor(fields: object) {
      Object.assign(this, fields);
    }
  }
  class MockInputPeerChannel {
    constructor(fields: object) {
      Object.assign(this, fields);
    }
  }
  return { Api: { Message: MockMessage, InputPeerChannel: MockInputPeerChannel } };
});

// The DI tokens must exist, but neither GramJS nor the alert pipeline is loaded here.
jest.mock('./session-store', () => ({ SessionStore: class {} }));
jest.mock('../alerts/alert.service', () => ({ AlertService: class {} }));

interface FakeInputPeerChannel {
  channelId: { toString(): string };
  accessHash: { toString(): string };
}

const { Api: mockApi } = jest.requireMock<{
  Api: {
    Message: new (fields: object) => object;
    InputPeerChannel: new (fields: object) => FakeInputPeerChannel;
  };
}>('telegram/tl');

interface MockClient {
  getInputEntity: jest.Mock<Promise<unknown>, [string]>;
  getMessages: jest.Mock<Promise<unknown[]>, [unknown, unknown]>;
}

interface MockSessions {
  getConnected: jest.Mock<Promise<TelegramClient>, [string]>;
  evictIfSessionInvalid: jest.Mock<Promise<void>, [string, unknown]>;
}

const inputSession = 'fake-session-for-channel-service';
const inputChannel = 'fake_channel';
const INPUT_HOURS_BACK = 1;
const INPUT_FLOOD_SECONDS = 30;
const FIRST_MESSAGE_ID = 500;
const FAKE_NOW_MS = 1_700_000_000_000;
const IN_WINDOW_DATE_S = FAKE_NOW_MS / MS_IN_SECOND - INPUT_HOURS_BACK * SECONDS_IN_HOUR;

const inputStoredPeer: ChannelPeer = { channelId: '1001234567890', accessHash: '-5555555555555' };
const inputFreshPeer: ChannelPeer = { channelId: '1009999999999', accessHash: '7777777777777' };

function rpcError(code: string): Error {
  return Object.assign(new Error(`RPCError: 400: ${code} (caused by fake.Call)`), {
    errorMessage: code,
  });
}

function buildInputPeer(peer: ChannelPeer): FakeInputPeerChannel {
  return new mockApi.InputPeerChannel({
    channelId: bigInt(peer.channelId),
    accessHash: bigInt(peer.accessHash),
  });
}

function buildPostPage(): object[] {
  return [new mockApi.Message({ id: FIRST_MESSAGE_ID, date: IN_WINDOW_DATE_S, message: 'fake' })];
}

function peerOf(input: unknown): ChannelPeer {
  expect(input).toBeInstanceOf(mockApi.InputPeerChannel);
  const { channelId, accessHash } = input as FakeInputPeerChannel;
  return { channelId: channelId.toString(), accessHash: accessHash.toString() };
}

interface Harness {
  service: ChannelService;
  client: MockClient;
  sessions: MockSessions;
  peers: ChannelPeerCache;
  alerts: { info: jest.Mock; warning: jest.Mock; error: jest.Mock };
}

function buildHarness(peers: ChannelPeerCache = new ChannelPeerCache(null)): Harness {
  const client: MockClient = {
    getInputEntity: jest.fn().mockResolvedValue(buildInputPeer(inputFreshPeer)),
    getMessages: jest.fn().mockImplementation(async () => buildPostPage()),
  };
  const sessions: MockSessions = {
    getConnected: jest.fn().mockResolvedValue(client as unknown as TelegramClient),
    evictIfSessionInvalid: jest.fn().mockResolvedValue(undefined),
  };
  const alerts = { info: jest.fn(), warning: jest.fn(), error: jest.fn() };
  const service = new ChannelService(
    sessions as unknown as SessionStore,
    peers,
    alerts as unknown as AlertService,
  );
  return { service, client, sessions, peers, alerts };
}

function readPosts(harness: Harness): ReturnType<ChannelService['getChannelPosts']> {
  return harness.service.getChannelPosts(inputChannel, inputSession, INPUT_HOURS_BACK);
}

describe('ChannelService (channel peer cache)', () => {
  let loggerSpies: jest.SpyInstance[];

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(FAKE_NOW_MS);
    loggerSpies = (['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function loggedText(): string {
    return loggerSpies
      .flatMap((spy) => spy.mock.calls.flat())
      .map((argument) => String(argument))
      .join(' | ');
  }

  describe('miss', () => {
    it('looks the channel up, walks with the lookup result and stores the peer', async () => {
      // Arrange
      const harness = buildHarness();

      // Act
      const actualResult = await readPosts(harness);

      // Assert
      expect(actualResult.count).toBe(1);
      expect(harness.client.getInputEntity).toHaveBeenCalledTimes(1);
      expect(harness.client.getInputEntity).toHaveBeenCalledWith(inputChannel);
      expect(peerOf(harness.client.getMessages.mock.calls[0][0])).toEqual(inputFreshPeer);
      await expect(harness.peers.get(inputSession, inputChannel)).resolves.toEqual(inputFreshPeer);
    });

    it('does not store a lookup result that is not a channel peer', async () => {
      // Arrange
      const harness = buildHarness();
      const inputPlainPeer = { fakeInputPeer: 'fake-user-peer' };
      harness.client.getInputEntity.mockResolvedValue(inputPlainPeer);

      // Act
      await readPosts(harness);
      await readPosts(harness);

      // Assert
      expect(harness.client.getInputEntity).toHaveBeenCalledTimes(2);
      expect(harness.client.getMessages).toHaveBeenNthCalledWith(
        1,
        inputPlainPeer,
        expect.anything(),
      );
      await expect(harness.peers.get(inputSession, inputChannel)).resolves.toBeUndefined();
    });

    it('does not store anything when the lookup fails', async () => {
      // Arrange
      const harness = buildHarness();
      harness.client.getInputEntity.mockRejectedValue(rpcError('CHANNEL_PRIVATE'));

      // Act
      const actualResult = readPosts(harness);

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(NotFoundException);
      await expect(harness.peers.get(inputSession, inputChannel)).resolves.toBeUndefined();
    });
  });

  describe('hit', () => {
    it('a second read of the same channel by the same session skips the username lookup', async () => {
      // Arrange
      const harness = buildHarness();
      await readPosts(harness);
      harness.client.getInputEntity.mockClear();
      harness.client.getMessages.mockClear();

      // Act
      const actualResult = await readPosts(harness);

      // Assert
      expect(actualResult.count).toBe(1);
      expect(harness.client.getInputEntity).not.toHaveBeenCalled();
      expect(harness.client.getMessages).toHaveBeenCalledTimes(1);
      expect(peerOf(harness.client.getMessages.mock.calls[0][0])).toEqual(inputFreshPeer);
    });

    it('walks with an InputPeerChannel built from the stored decimal strings', async () => {
      // Arrange
      const harness = buildHarness();
      await harness.peers.set(inputSession, inputChannel, inputStoredPeer);

      // Act
      await readPosts(harness);

      // Assert
      expect(harness.client.getInputEntity).not.toHaveBeenCalled();
      expect(peerOf(harness.client.getMessages.mock.calls[0][0])).toEqual(inputStoredPeer);
    });

    it('a different session reading the same channel still looks it up', async () => {
      // Arrange
      const harness = buildHarness();
      await harness.peers.set('fake-other-session', inputChannel, inputStoredPeer);

      // Act
      await readPosts(harness);

      // Assert
      expect(harness.client.getInputEntity).toHaveBeenCalledTimes(1);
    });
  });

  describe('stale cached peer', () => {
    it.each(CHANNEL_PEER_STALE_ERRORS)(
      '%s on the cached read drops the entry, does one lookup and succeeds',
      async (inputCode) => {
        // Arrange
        const harness = buildHarness();
        await harness.peers.set(inputSession, inputChannel, inputStoredPeer);
        harness.client.getMessages.mockRejectedValueOnce(rpcError(inputCode));

        // Act
        const actualResult = await readPosts(harness);

        // Assert
        expect(actualResult.count).toBe(1);
        expect(harness.client.getInputEntity).toHaveBeenCalledTimes(1);
        expect(harness.client.getMessages).toHaveBeenCalledTimes(2);
        expect(peerOf(harness.client.getMessages.mock.calls[0][0])).toEqual(inputStoredPeer);
        expect(peerOf(harness.client.getMessages.mock.calls[1][0])).toEqual(inputFreshPeer);
        await expect(harness.peers.get(inputSession, inputChannel)).resolves.toEqual(
          inputFreshPeer,
        );
        expect(harness.sessions.evictIfSessionInvalid).not.toHaveBeenCalled();
        expect(harness.alerts.warning).not.toHaveBeenCalled();
        expect(harness.alerts.error).not.toHaveBeenCalled();
      },
    );

    it('CHANNEL_PRIVATE on the cached read also retries once; a failing lookup maps to 404', async () => {
      // Arrange
      const harness = buildHarness();
      await harness.peers.set(inputSession, inputChannel, inputStoredPeer);
      harness.client.getMessages.mockRejectedValueOnce(rpcError('CHANNEL_PRIVATE'));
      harness.client.getInputEntity.mockRejectedValueOnce(rpcError('CHANNEL_PRIVATE'));

      // Act
      const actualResult = readPosts(harness);

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(NotFoundException);
      expect(harness.client.getInputEntity).toHaveBeenCalledTimes(1);
      expect(harness.client.getMessages).toHaveBeenCalledTimes(1);
      await expect(harness.peers.get(inputSession, inputChannel)).resolves.toBeUndefined();
    });

    it('a stale error on the read after the fresh lookup is not retried again', async () => {
      // Arrange
      const harness = buildHarness();
      await harness.peers.set(inputSession, inputChannel, inputStoredPeer);
      harness.client.getMessages.mockRejectedValue(rpcError('CHANNEL_INVALID'));

      // Act
      const actualResult = readPosts(harness);

      // Assert
      await expect(actualResult).rejects.toBeInstanceOf(NotFoundException);
      expect(harness.client.getInputEntity).toHaveBeenCalledTimes(1);
      expect(harness.client.getMessages).toHaveBeenCalledTimes(2);
    });
  });

  describe('non-stale failure on the cached read', () => {
    it('maps a flood wait to 429 without a username lookup and keeps the entry', async () => {
      // Arrange
      const harness = buildHarness();
      await harness.peers.set(inputSession, inputChannel, inputStoredPeer);
      harness.client.getMessages.mockRejectedValueOnce(
        Object.assign(new Error('fake A wait is required'), {
          errorMessage: 'FLOOD',
          seconds: INPUT_FLOOD_SECONDS,
        }),
      );

      // Act
      const actualError = await readPosts(harness).catch((error: unknown) => error);

      // Assert
      expect(actualError).toBeInstanceOf(TooManyRequestsException);
      expect((actualError as TooManyRequestsException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(harness.client.getInputEntity).not.toHaveBeenCalled();
      await expect(harness.peers.get(inputSession, inputChannel)).resolves.toEqual(inputStoredPeer);
      expect(loggedText()).toContain(
        `failed: ${HttpStatus.TOO_MANY_REQUESTS} (FLOOD_WAIT_${INPUT_FLOOD_SECONDS})`,
      );
    });

    it('lets the session store judge an invalid-session error and does not look up', async () => {
      // Arrange
      const harness = buildHarness();
      await harness.peers.set(inputSession, inputChannel, inputStoredPeer);
      const inputError = rpcError('AUTH_KEY_UNREGISTERED');
      harness.client.getMessages.mockRejectedValueOnce(inputError);

      // Act
      const actualResult = readPosts(harness);

      // Assert
      await expect(actualResult).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
      expect(harness.client.getInputEntity).not.toHaveBeenCalled();
      expect(harness.sessions.evictIfSessionInvalid).toHaveBeenCalledWith(inputSession, inputError);
    });
  });

  describe('Redis-backed cache', () => {
    it('stores under the session hash and reuses the peer on the next read', async () => {
      // Arrange
      const fakeRedis = new FakeRedis();
      const harness = buildHarness(new ChannelPeerCache(fakeRedis.asRedis()));
      await readPosts(harness);

      // Act
      await readPosts(harness);

      // Assert
      expect(harness.client.getInputEntity).toHaveBeenCalledTimes(1);
      expect(fakeRedis.touchedKeys()).toContain(
        `${CHANNEL_PEER_KEY_PREFIX}${hashSecret(inputSession)}:${inputChannel}`,
      );
    });

    it('a failing Redis does not change the posts result', async () => {
      // Arrange
      const expectedResult = await readPosts(buildHarness());
      const fakeRedis = new FakeRedis();
      fakeRedis.failAll(Object.assign(new Error('fake ECONNREFUSED'), { name: 'FakeRedisError' }));
      const harness = buildHarness(new ChannelPeerCache(fakeRedis.asRedis()));

      // Act
      const actualFirst = await readPosts(harness);
      const actualSecond = await readPosts(harness);

      // Assert
      expect(actualFirst).toEqual(expectedResult);
      expect(actualSecond).toEqual(expectedResult);
      expect(harness.client.getInputEntity).toHaveBeenCalledTimes(2);
      expect(harness.alerts.error).not.toHaveBeenCalled();
      expect(harness.alerts.warning).not.toHaveBeenCalled();
    });
  });

  it('never logs the session string or the access hash', async () => {
    // Arrange
    const harness = buildHarness();
    await harness.peers.set(inputSession, inputChannel, inputStoredPeer);
    harness.client.getMessages.mockRejectedValueOnce(rpcError('CHANNEL_INVALID'));
    harness.client.getMessages.mockRejectedValueOnce(rpcError('CHANNEL_INVALID'));

    // Act
    await readPosts(harness).catch(() => undefined);
    await readPosts(harness);

    // Assert
    const actualText = loggedText();
    expect(actualText).not.toContain(inputSession);
    expect(actualText).not.toContain(inputStoredPeer.accessHash);
    expect(actualText).not.toContain(inputFreshPeer.accessHash);
    expect(JSON.stringify(harness.alerts.warning.mock.calls)).not.toContain(inputSession);
  });
});
