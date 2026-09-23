import { RATE_LIMIT_STORE_MAX_ENTRIES } from '../constants/rate-limit.constants';
import { RateLimitStore, hashRateLimitSubject } from './rate-limit-store';
import type { RateLimitDecision } from './rate-limit-store';

const INPUT_MAX_REQUESTS = 3;
const INPUT_WINDOW_MS = 1000;
const INPUT_MAX_ENTRIES = 4;
const INPUT_START_MS = 10_000;
const INPUT_ELAPSED_MS = 400;
const INPUT_STAGGER_MS = 100;
const FLOOD_FACTOR = 2;
const SHA256_HEX_LENGTH = 64;
const TWO_ENTRIES = 2;

const inputSubject = 'fake-subject-one';
const inputOtherSubject = 'fake-subject-two';

function createStore(maxEntries: number = INPUT_MAX_ENTRIES): RateLimitStore {
  return new RateLimitStore({
    maxRequests: INPUT_MAX_REQUESTS,
    windowMs: INPUT_WINDOW_MS,
    maxEntries,
  });
}

function consumeTimes(
  store: RateLimitStore,
  subject: string,
  times: number,
  nowMs: number,
): RateLimitDecision[] {
  const decisions: RateLimitDecision[] = [];
  for (let attempt = 0; attempt < times; attempt += 1) {
    decisions.push(store.consume(subject, nowMs));
  }

  return decisions;
}

function fillStore(store: RateLimitStore, entryCount: number, nowMs: number): void {
  for (let index = 0; index < entryCount; index += 1) {
    store.consume(`fake-filler-subject-${index}`, nowMs);
  }
}

function floodStore(store: RateLimitStore, floodSize: number, nowMs: number): number[] {
  const sizes: number[] = [];
  for (let index = 0; index < floodSize; index += 1) {
    store.consume(`fake-flood-subject-${index}`, nowMs);
    sizes.push(store.size);
  }

  return sizes;
}

describe('RateLimitStore', () => {
  it('allows exactly maxRequests requests inside one window', () => {
    const inputStore = createStore();

    const actualDecisions = consumeTimes(
      inputStore,
      inputSubject,
      INPUT_MAX_REQUESTS,
      INPUT_START_MS,
    );

    const expectedDecisions = Array.from({ length: INPUT_MAX_REQUESTS }, () => ({
      isAllowed: true,
      retryAfterMs: 0,
    }));
    expect(actualDecisions).toEqual(expectedDecisions);
  });

  it('rejects the request after the limit is reached', () => {
    const inputStore = createStore();
    consumeTimes(inputStore, inputSubject, INPUT_MAX_REQUESTS, INPUT_START_MS);

    const actualDecision = inputStore.consume(inputSubject, INPUT_START_MS);

    expect(actualDecision.isAllowed).toBe(false);
  });

  it('reports the time left in the current window as retryAfterMs', () => {
    const inputStore = createStore();
    consumeTimes(inputStore, inputSubject, INPUT_MAX_REQUESTS, INPUT_START_MS);

    const actualDecision = inputStore.consume(inputSubject, INPUT_START_MS + INPUT_ELAPSED_MS);

    const expectedRetryAfterMs = INPUT_WINDOW_MS - INPUT_ELAPSED_MS;
    expect(actualDecision).toEqual({ isAllowed: false, retryAfterMs: expectedRetryAfterMs });
  });

  it('allows the subject again once the window has elapsed', () => {
    const inputStore = createStore();
    consumeTimes(inputStore, inputSubject, INPUT_MAX_REQUESTS, INPUT_START_MS);
    const actualBlockedDecision = inputStore.consume(inputSubject, INPUT_START_MS);

    const actualRecoveredDecision = inputStore.consume(
      inputSubject,
      INPUT_START_MS + INPUT_WINDOW_MS,
    );

    expect(actualBlockedDecision.isAllowed).toBe(false);
    expect(actualRecoveredDecision).toEqual({ isAllowed: true, retryAfterMs: 0 });
  });

  it('counts a fresh window from the first request after recovery', () => {
    const inputStore = createStore();
    consumeTimes(inputStore, inputSubject, INPUT_MAX_REQUESTS, INPUT_START_MS);
    const inputRecoveryMs = INPUT_START_MS + INPUT_WINDOW_MS;

    const actualDecisions = consumeTimes(
      inputStore,
      inputSubject,
      INPUT_MAX_REQUESTS,
      inputRecoveryMs,
    );
    const actualNextDecision = inputStore.consume(inputSubject, inputRecoveryMs);

    expect(actualDecisions.every((decision) => decision.isAllowed)).toBe(true);
    expect(actualNextDecision.isAllowed).toBe(false);
  });

  it('counts distinct subjects independently', () => {
    const inputStore = createStore();
    consumeTimes(inputStore, inputSubject, INPUT_MAX_REQUESTS, INPUT_START_MS);

    const actualBlockedDecision = inputStore.consume(inputSubject, INPUT_START_MS);
    const actualOtherDecision = inputStore.consume(inputOtherSubject, INPUT_START_MS);

    expect(actualBlockedDecision.isAllowed).toBe(false);
    expect(actualOtherDecision).toEqual({ isAllowed: true, retryAfterMs: 0 });
  });

  it('uses the default clock when no nowMs is passed', () => {
    const inputStore = createStore();

    const actualDecisions = consumeTimes(inputStore, inputSubject, INPUT_MAX_REQUESTS, Date.now());
    const actualNextDecision = inputStore.consume(inputSubject);

    expect(actualDecisions.every((decision) => decision.isAllowed)).toBe(true);
    expect(actualNextDecision.isAllowed).toBe(false);
  });

  it('drops expired windows, so size shrinks instead of growing', () => {
    const inputStore = createStore();
    inputStore.consume(inputSubject, INPUT_START_MS);
    inputStore.consume(inputOtherSubject, INPUT_START_MS);
    const actualSizeBefore = inputStore.size;

    inputStore.consume('fake-subject-three', INPUT_START_MS + INPUT_WINDOW_MS);

    expect(actualSizeBefore).toBe(TWO_ENTRIES);
    expect(inputStore.size).toBe(1);
  });

  it('never lets size exceed maxEntries while a flood of unique subjects arrives', () => {
    const inputStore = createStore();
    const inputFloodSize = INPUT_MAX_ENTRIES * FLOOD_FACTOR;

    const actualSizes = floodStore(inputStore, inputFloodSize, INPUT_START_MS);

    expect(Math.max(...actualSizes)).toBe(INPUT_MAX_ENTRIES);
    expect(inputStore.size).toBe(INPUT_MAX_ENTRIES);
  });

  it('keeps size at RATE_LIMIT_STORE_MAX_ENTRIES for a flood at the production ceiling', () => {
    const inputStore = createStore(RATE_LIMIT_STORE_MAX_ENTRIES);
    const inputFloodSize = RATE_LIMIT_STORE_MAX_ENTRIES * FLOOD_FACTOR;

    const actualSizes = floodStore(inputStore, inputFloodSize, INPUT_START_MS);

    expect(Math.max(...actualSizes)).toBe(RATE_LIMIT_STORE_MAX_ENTRIES);
    expect(inputStore.size).toBe(RATE_LIMIT_STORE_MAX_ENTRIES);
  });

  it('refuses a new subject while every window in a full store is still live', () => {
    const inputStore = createStore();
    fillStore(inputStore, INPUT_MAX_ENTRIES, INPUT_START_MS);

    const actualDecision = inputStore.consume(
      'fake-unseen-subject',
      INPUT_START_MS + INPUT_ELAPSED_MS,
    );

    expect(actualDecision).toEqual({
      isAllowed: false,
      retryAfterMs: INPUT_WINDOW_MS - INPUT_ELAPSED_MS,
    });
    expect(inputStore.size).toBe(INPUT_MAX_ENTRIES);
  });

  it('reports the oldest live window as retryAfterMs when it refuses a new subject', () => {
    const inputStore = createStore();
    inputStore.consume('fake-oldest-subject', INPUT_START_MS);
    fillStore(inputStore, INPUT_MAX_ENTRIES - 1, INPUT_START_MS + INPUT_STAGGER_MS);

    const actualDecision = inputStore.consume('fake-unseen-subject', INPUT_START_MS);

    expect(actualDecision).toEqual({ isAllowed: false, retryAfterMs: INPUT_WINDOW_MS });
  });

  it('admits a new subject again once the oldest window has expired', () => {
    const inputStore = createStore();
    inputStore.consume('fake-oldest-subject', INPUT_START_MS);
    fillStore(inputStore, INPUT_MAX_ENTRIES - 1, INPUT_START_MS + INPUT_STAGGER_MS);

    const actualRefusedDecision = inputStore.consume(
      'fake-unseen-subject',
      INPUT_START_MS + INPUT_WINDOW_MS - 1,
    );
    const actualAdmittedDecision = inputStore.consume(
      'fake-unseen-subject',
      INPUT_START_MS + INPUT_WINDOW_MS,
    );

    expect(actualRefusedDecision).toEqual({ isAllowed: false, retryAfterMs: 1 });
    expect(actualAdmittedDecision).toEqual({ isAllowed: true, retryAfterMs: 0 });
  });

  it('keeps an exhausted subject counter intact through a flood of unique subjects', () => {
    const inputStore = createStore();
    consumeTimes(inputStore, inputSubject, INPUT_MAX_REQUESTS, INPUT_START_MS);

    floodStore(inputStore, INPUT_MAX_ENTRIES * FLOOD_FACTOR, INPUT_START_MS);
    const actualDecision = inputStore.consume(inputSubject, INPUT_START_MS);

    expect(actualDecision).toEqual({ isAllowed: false, retryAfterMs: INPUT_WINDOW_MS });
  });

  it('keeps a partially used subject counter intact through a flood of unique subjects', () => {
    const inputStore = createStore();
    inputStore.consume(inputSubject, INPUT_START_MS);

    floodStore(inputStore, INPUT_MAX_ENTRIES * FLOOD_FACTOR, INPUT_START_MS);
    const actualDecisions = consumeTimes(
      inputStore,
      inputSubject,
      INPUT_MAX_REQUESTS,
      INPUT_START_MS,
    );

    const expectedDecisions = [
      { isAllowed: true, retryAfterMs: 0 },
      { isAllowed: true, retryAfterMs: 0 },
      { isAllowed: false, retryAfterMs: INPUT_WINDOW_MS },
    ];
    expect(actualDecisions).toEqual(expectedDecisions);
  });

  it('survives a flood at the production ceiling, so unknown subjects cannot reset a real counter', () => {
    const inputStore = createStore(RATE_LIMIT_STORE_MAX_ENTRIES);
    consumeTimes(inputStore, inputSubject, INPUT_MAX_REQUESTS, INPUT_START_MS);

    floodStore(inputStore, RATE_LIMIT_STORE_MAX_ENTRIES * FLOOD_FACTOR, INPUT_START_MS);
    const actualDecision = inputStore.consume(inputSubject, INPUT_START_MS);

    expect(actualDecision.isAllowed).toBe(false);
  });
});

describe('hashRateLimitSubject', () => {
  it('never returns the raw subject', () => {
    const actualDigest = hashRateLimitSubject(inputSubject);

    expect(actualDigest).not.toBe(inputSubject);
    expect(actualDigest).not.toContain(inputSubject);
  });

  it('returns a stable sha256 hex digest', () => {
    const actualDigest = hashRateLimitSubject(inputSubject);

    expect(actualDigest).toMatch(/^[0-9a-f]+$/);
    expect(actualDigest).toHaveLength(SHA256_HEX_LENGTH);
    expect(hashRateLimitSubject(inputSubject)).toBe(actualDigest);
  });

  it('maps distinct subjects to distinct digests', () => {
    const actualDigest = hashRateLimitSubject(inputSubject);
    const actualOtherDigest = hashRateLimitSubject(inputOtherSubject);

    expect(actualDigest).not.toBe(actualOtherDigest);
  });

  it('makes the store behave identically for a subject and for its digest', () => {
    const inputRawStore = createStore();
    const inputDigestStore = createStore();
    const inputDigest = hashRateLimitSubject(inputSubject);

    const actualRawDecisions = consumeTimes(
      inputRawStore,
      inputSubject,
      INPUT_MAX_REQUESTS + 1,
      INPUT_START_MS,
    );
    const actualDigestDecisions = consumeTimes(
      inputDigestStore,
      inputDigest,
      INPUT_MAX_REQUESTS + 1,
      INPUT_START_MS,
    );

    expect(actualRawDecisions).toEqual(actualDigestDecisions);
  });

  it('keeps a subject and its digest on separate counters, so the raw value is not the key', () => {
    const inputStore = createStore();
    const inputDigest = hashRateLimitSubject(inputSubject);
    consumeTimes(inputStore, inputSubject, INPUT_MAX_REQUESTS, INPUT_START_MS);

    const actualBlockedDecision = inputStore.consume(inputSubject, INPUT_START_MS);
    const actualDigestDecision = inputStore.consume(inputDigest, INPUT_START_MS);

    expect(actualBlockedDecision.isAllowed).toBe(false);
    expect(actualDigestDecision.isAllowed).toBe(true);
  });
});
