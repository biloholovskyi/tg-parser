import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { FakeRedis } from '../../test/fake-redis';
import type { SessionPersistenceConfig } from '../config/redis.config';
import { SECRET_KEY_BYTES, encryptSecret, hashSecret } from '../shared/utils/secret-cipher';
import { DIGEST_SESSION_KEY, SESSION_STORE_KEY_PREFIX, SESSION_STORE_TTL_S } from './constants';
import { SessionRepository } from './session-repository';
import { SESSION_STORAGE_UNAVAILABLE_MESSAGE } from './utils/telegram-errors';

const inputSessionString = 'fake-repository-session-string';
const inputOtherSessionString = 'fake-repository-other-session-string';
const inputKey = Buffer.alloc(SECRET_KEY_BYTES, 5);
const inputOtherKey = Buffer.alloc(SECRET_KEY_BYTES, 6);
const inputConfig: SessionPersistenceConfig = {
  redisUrl: 'redis://fake-redis.invalid:6379',
  encryptionKey: inputKey,
};

const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;

function recordKeyOf(sessionString: string): string {
  return SESSION_STORE_KEY_PREFIX + hashSecret(sessionString);
}

async function captureError(actualPromise: Promise<unknown>): Promise<unknown> {
  return actualPromise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function expectStorageUnavailable(actualError: unknown, expectedCause: Error): void {
  expect(actualError).toBeInstanceOf(ServiceUnavailableException);
  expect((actualError as ServiceUnavailableException).getStatus()).toBe(503);
  expect((actualError as ServiceUnavailableException).message).toBe(
    SESSION_STORAGE_UNAVAILABLE_MESSAGE,
  );
  expect((actualError as Error & { cause?: unknown }).cause).toBe(expectedCause);
}

describe('SessionRepository', () => {
  describe('with Redis', () => {
    let fakeRedis: FakeRedis;
    let repository: SessionRepository;

    beforeEach(() => {
      fakeRedis = new FakeRedis();
      repository = new SessionRepository(fakeRedis.asRedis(), inputConfig);
    });

    describe('save', () => {
      it('stores the encrypted session under its sha256 key with SESSION_STORE_TTL_S', async () => {
        // Act
        await repository.save(inputSessionString);

        // Assert
        const expectedKey = recordKeyOf(inputSessionString);
        expect(fakeRedis.calls).toEqual([
          {
            command: 'set',
            args: [expectedKey, expect.any(String), 'EX', SESSION_STORE_TTL_S],
          },
        ]);
        expect(fakeRedis.ttls.get(expectedKey)).toBe(SESSION_STORE_TTL_S);
      });

      it('never writes the session string in a key or a value', async () => {
        // Act
        await repository.save(inputSessionString);

        // Assert
        for (const [actualKey, actualValue] of fakeRedis.values) {
          expect(actualKey).not.toContain(inputSessionString);
          expect(actualValue).not.toContain(inputSessionString);
          expect(Buffer.from(actualValue, 'base64').toString('utf8')).not.toContain(
            inputSessionString,
          );
        }
      });

      it('turns a Redis rejection into the 503', async () => {
        // Arrange
        const inputError = new Error('fake ECONNREFUSED');
        fakeRedis.failAll(inputError);

        // Act
        const actualError = await captureError(repository.save(inputSessionString));

        // Assert
        expectStorageUnavailable(actualError, inputError);
      });
    });

    describe('isKnown', () => {
      it('is true for a saved session and extends its lifetime', async () => {
        // Arrange
        await repository.save(inputSessionString);
        fakeRedis.ttls.set(recordKeyOf(inputSessionString), 1);
        fakeRedis.calls.length = 0;

        // Act
        const actualKnown = await repository.isKnown(inputSessionString);

        // Assert
        expect(actualKnown).toBe(true);
        expect(fakeRedis.calls.map((call) => call.command)).toEqual(['get', 'expire']);
        expect(fakeRedis.ttls.get(recordKeyOf(inputSessionString))).toBe(SESSION_STORE_TTL_S);
      });

      it('is false for a session never saved, without extending anything', async () => {
        // Act
        const actualKnown = await repository.isKnown(inputSessionString);

        // Assert
        expect(actualKnown).toBe(false);
        expect(fakeRedis.calls.map((call) => call.command)).toEqual(['get']);
      });

      it('is false for a different session', async () => {
        // Arrange
        await repository.save(inputSessionString);

        // Act
        const actualKnown = await repository.isKnown(inputOtherSessionString);

        // Assert
        expect(actualKnown).toBe(false);
      });

      it('is false when the decrypted record does not match the presented session', async () => {
        // Arrange: a record under this session's hash that holds another plaintext
        fakeRedis.values.set(
          recordKeyOf(inputSessionString),
          encryptSecret(inputOtherSessionString, inputKey),
        );

        // Act
        const actualKnown = await repository.isKnown(inputSessionString);

        // Assert
        expect(actualKnown).toBe(false);
        expect(fakeRedis.calls.map((call) => call.command)).not.toContain('expire');
      });

      it('deletes a record encrypted under another key and reports unknown', async () => {
        // Arrange
        const inputKey2Repository = new SessionRepository(fakeRedis.asRedis(), {
          ...inputConfig,
          encryptionKey: inputOtherKey,
        });
        await inputKey2Repository.save(inputSessionString);

        // Act
        const actualKnown = await repository.isKnown(inputSessionString);

        // Assert
        expect(actualKnown).toBe(false);
        expect(fakeRedis.values.has(recordKeyOf(inputSessionString))).toBe(false);
        expect(fakeRedis.calls[fakeRedis.calls.length - 1]).toEqual({
          command: 'del',
          args: [recordKeyOf(inputSessionString)],
        });
      });

      it('deletes a corrupt record and reports unknown', async () => {
        // Arrange
        fakeRedis.values.set(recordKeyOf(inputSessionString), 'fake-corrupt');

        // Act
        const actualKnown = await repository.isKnown(inputSessionString);

        // Assert
        expect(actualKnown).toBe(false);
        expect(fakeRedis.values.has(recordKeyOf(inputSessionString))).toBe(false);
      });

      it('turns a Redis rejection into the 503, not into "unknown"', async () => {
        // Arrange
        await repository.save(inputSessionString);
        const inputError = new Error('fake ETIMEDOUT');
        fakeRedis.failAll(inputError);

        // Act
        const actualError = await captureError(repository.isKnown(inputSessionString));

        // Assert
        expectStorageUnavailable(actualError, inputError);
      });

      it('turns a failed delete of a corrupt record into the 503', async () => {
        // Arrange
        fakeRedis.values.set(recordKeyOf(inputSessionString), 'fake-corrupt');
        const inputError = new Error('fake ECONNRESET');
        const originalDel = fakeRedis.del.bind(fakeRedis);
        jest.spyOn(fakeRedis, 'del').mockImplementationOnce(async (key: string) => {
          await originalDel(key).catch(() => undefined);
          throw inputError;
        });

        // Act
        const actualError = await captureError(repository.isKnown(inputSessionString));

        // Assert
        expectStorageUnavailable(actualError, inputError);
      });
    });

    describe('touch', () => {
      it('extends the stored session to SESSION_STORE_TTL_S', async () => {
        // Arrange
        await repository.save(inputSessionString);
        fakeRedis.ttls.set(recordKeyOf(inputSessionString), 1);

        // Act
        await repository.touch(inputSessionString);

        // Assert
        expect(fakeRedis.calls[fakeRedis.calls.length - 1]).toEqual({
          command: 'expire',
          args: [recordKeyOf(inputSessionString), SESSION_STORE_TTL_S],
        });
        expect(fakeRedis.ttls.get(recordKeyOf(inputSessionString))).toBe(SESSION_STORE_TTL_S);
      });

      it('is a no-op for an unknown session and creates no record', async () => {
        // Act
        await repository.touch(inputSessionString);

        // Assert
        expect(fakeRedis.values.size).toBe(0);
      });

      it('turns a Redis rejection into the 503', async () => {
        // Arrange
        const inputError = new Error('fake ECONNREFUSED');
        fakeRedis.failAll(inputError);

        // Act
        const actualError = await captureError(repository.touch(inputSessionString));

        // Assert
        expectStorageUnavailable(actualError, inputError);
      });
    });

    describe('remove', () => {
      it('deletes the record so the session is no longer known', async () => {
        // Arrange
        await repository.save(inputSessionString);
        await repository.save(inputOtherSessionString);

        // Act
        await repository.remove(inputSessionString);

        // Assert
        expect(await repository.isKnown(inputSessionString)).toBe(false);
        expect(await repository.isKnown(inputOtherSessionString)).toBe(true);
      });

      it('clears the digest mark when it points at the removed session', async () => {
        // Arrange
        await repository.save(inputSessionString);
        await repository.markDigest(inputSessionString);

        // Act
        await repository.remove(inputSessionString);

        // Assert
        expect(fakeRedis.values.has(DIGEST_SESSION_KEY)).toBe(false);
        expect(await repository.loadDigest()).toBeUndefined();
      });

      it('keeps the digest mark when it points at another session', async () => {
        // Arrange
        await repository.save(inputSessionString);
        await repository.save(inputOtherSessionString);
        await repository.markDigest(inputOtherSessionString);

        // Act
        await repository.remove(inputSessionString);

        // Assert
        expect(fakeRedis.values.get(DIGEST_SESSION_KEY)).toBe(hashSecret(inputOtherSessionString));
        expect(await repository.loadDigest()).toBe(inputOtherSessionString);
      });

      it('turns a Redis rejection into the 503', async () => {
        // Arrange
        const inputError = new Error('fake ECONNREFUSED');
        fakeRedis.failAll(inputError);

        // Act
        const actualError = await captureError(repository.remove(inputSessionString));

        // Assert
        expectStorageUnavailable(actualError, inputError);
      });
    });

    describe('markDigest / loadDigest', () => {
      it('stores only the hash under DIGEST_SESSION_KEY and loads the session back', async () => {
        // Arrange
        await repository.save(inputSessionString);

        // Act
        await repository.markDigest(inputSessionString);
        const actualDigest = await repository.loadDigest();

        // Assert
        expect(fakeRedis.values.get(DIGEST_SESSION_KEY)).toBe(hashSecret(inputSessionString));
        expect(fakeRedis.ttls.has(DIGEST_SESSION_KEY)).toBe(false);
        expect(actualDigest).toBe(inputSessionString);
      });

      it('loads undefined when nothing is marked', async () => {
        // Act
        const actualDigest = await repository.loadDigest();

        // Assert
        expect(actualDigest).toBeUndefined();
      });

      it('loads undefined when the marked session record is gone', async () => {
        // Arrange
        await repository.save(inputSessionString);
        await repository.markDigest(inputSessionString);
        fakeRedis.values.delete(recordKeyOf(inputSessionString));

        // Act
        const actualDigest = await repository.loadDigest();

        // Assert
        expect(actualDigest).toBeUndefined();
      });

      it('loads undefined and deletes the record when it no longer decrypts', async () => {
        // Arrange
        await repository.save(inputSessionString);
        await repository.markDigest(inputSessionString);
        fakeRedis.values.set(recordKeyOf(inputSessionString), 'fake-corrupt');

        // Act
        const actualDigest = await repository.loadDigest();

        // Assert
        expect(actualDigest).toBeUndefined();
        expect(fakeRedis.values.has(recordKeyOf(inputSessionString))).toBe(false);
      });

      it.each([
        ['markDigest', (subject: SessionRepository) => subject.markDigest(inputSessionString)],
        ['loadDigest', (subject: SessionRepository) => subject.loadDigest()],
      ])('%s turns a Redis rejection into the 503', async (_label, act) => {
        // Arrange
        const inputError = new Error('fake ECONNREFUSED');
        fakeRedis.failAll(inputError);

        // Act
        const actualError = await captureError(act(repository));

        // Assert
        expectStorageUnavailable(actualError, inputError);
      });
    });

    describe('secret hygiene', () => {
      it('never logs the session string or the key and never uses it in a Redis key', async () => {
        // Arrange
        const mockSpies = LOGGER_LEVELS.map((level) =>
          jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
        );

        // Act
        await repository.save(inputSessionString);
        await repository.isKnown(inputSessionString);
        await repository.touch(inputSessionString);
        await repository.markDigest(inputSessionString);
        await repository.loadDigest();
        fakeRedis.values.set(recordKeyOf(inputSessionString), 'fake-corrupt');
        await repository.isKnown(inputSessionString);
        await repository.remove(inputSessionString);
        fakeRedis.failAll();
        await captureError(repository.save(inputSessionString));

        // Assert
        const actualLogged = mockSpies
          .flatMap((spy) => spy.mock.calls.flat())
          .map((argument) => String(argument))
          .join(' | ');
        expect(actualLogged).not.toContain(inputSessionString);
        expect(actualLogged).not.toContain(inputKey.toString('base64'));
        for (const actualKey of fakeRedis.touchedKeys()) {
          expect(actualKey).not.toContain(inputSessionString);
        }
        jest.restoreAllMocks();
      });
    });
  });

  describe.each([
    ['no Redis client', null, inputConfig],
    ['no persistence config', 'redis', null],
  ] as const)('memory-only mode (%s)', (_label, redisMode, config) => {
    let fakeRedis: FakeRedis;
    let repository: SessionRepository;

    beforeEach(() => {
      fakeRedis = new FakeRedis();
      repository = new SessionRepository(redisMode ? fakeRedis.asRedis() : null, config);
    });

    it('save is a no-op and a saved session stays unknown', async () => {
      // Act
      await repository.save(inputSessionString);
      const actualKnown = await repository.isKnown(inputSessionString);

      // Assert
      expect(actualKnown).toBe(false);
      expect(fakeRedis.values.size).toBe(0);
    });

    it('remove resolves for an unknown session', async () => {
      // Act
      const actualResult = repository.remove(inputSessionString);

      // Assert
      await expect(actualResult).resolves.toBeUndefined();
    });

    it('keeps the digest mark in memory and never writes it to Redis', async () => {
      // Act
      await repository.markDigest(inputSessionString);
      const actualDigest = await repository.loadDigest();

      // Assert
      expect(actualDigest).toBe(inputSessionString);
      expect(fakeRedis.values.size).toBe(0);
    });
  });

  describe('memory-only mode without Redis', () => {
    let repository: SessionRepository;

    beforeEach(() => {
      repository = new SessionRepository(null, null);
    });

    it('touch resolves without doing anything', async () => {
      // Act
      const actualResult = repository.touch(inputSessionString);

      // Assert
      await expect(actualResult).resolves.toBeUndefined();
    });

    it('holds the digest mark in memory for the life of the process', async () => {
      // Act
      await repository.markDigest(inputSessionString);
      const actualDigest = await repository.loadDigest();

      // Assert
      expect(actualDigest).toBe(inputSessionString);
    });

    it('loads undefined when nothing is marked', async () => {
      // Act
      const actualDigest = await repository.loadDigest();

      // Assert
      expect(actualDigest).toBeUndefined();
    });

    it('remove clears the in-memory digest mark when it points at that session', async () => {
      // Arrange
      await repository.markDigest(inputSessionString);

      // Act
      await repository.remove(inputSessionString);

      // Assert
      expect(await repository.loadDigest()).toBeUndefined();
    });

    it('remove keeps the in-memory digest mark of another session', async () => {
      // Arrange
      await repository.markDigest(inputOtherSessionString);

      // Act
      await repository.remove(inputSessionString);

      // Assert
      expect(await repository.loadDigest()).toBe(inputOtherSessionString);
    });
  });
});
