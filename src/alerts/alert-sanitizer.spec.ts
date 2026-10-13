import { buildAlertPayload, redactText, sanitizeDetails, sanitizeMessage } from './alert-sanitizer';
import {
  ALERT_DETAILS_MAX_CHARS,
  ALERT_DETAILS_MAX_DEPTH,
  ALERT_DETAILS_MAX_ITEMS,
  ALERT_MESSAGE_MAX_CHARS,
  ALERT_REDACTED,
  ALERT_TOO_DEEP,
} from './constants';

const SESSION_BODY_CHARS = 250;
const FAKE_SESSION = '1' + 'A'.repeat(SESSION_BODY_CHARS);
const FAKE_PHONE = '+10000000000';
const FAKE_API_KEY = 'test-alert-key';
const FAKE_PASSWORD = 'fake-password-value';
const FAKE_BOT_TOKEN = 'fake-bot-token-value';
const FAKE_API_HASH = 'fake-api-hash-value';
const FAKE_PHONE_CODE = 'fake-code-value';
const FAKE_SECRET = 'fake-secret-value';
const FAKE_AUTHORIZATION = 'Bearer fake-authorization-value';
const INPUT_BARE_ID = '1234567890';
const FAKE_BOT_TOKEN_SHAPED = '123456789:' + 'B'.repeat(35);
const FAKE_XAI_KEY = 'xai-' + 'a'.repeat(30);
const FAKE_HEX_32 = 'f'.repeat(32);
const FAKE_HEX_40 = 'e'.repeat(40);

describe('redactText', () => {
  it('redacts a session string and a phone number', () => {
    // Arrange
    const inputText = `session=${FAKE_SESSION} phone ${FAKE_PHONE} end`;

    // Act
    const actualText = redactText(inputText);

    // Assert
    expect(actualText).toBe(`session=${ALERT_REDACTED} phone ${ALERT_REDACTED} end`);
  });

  it('keeps bare digit ids and counters', () => {
    // Arrange
    const inputText = `channel ${INPUT_BARE_ID} has 42 posts`;

    // Act
    const actualText = redactText(inputText);

    // Assert
    expect(actualText).toBe(inputText);
  });
});

describe('redactText value shapes', () => {
  it('redacts a session string that follows a letter with no word boundary', () => {
    // Act
    const actualText = redactText(`x${FAKE_SESSION} end`);

    // Assert
    expect(actualText).toBe(`x${ALERT_REDACTED} end`);
  });

  it.each([
    ['a bot token', `bot ${FAKE_BOT_TOKEN_SHAPED} rejected`, `bot ${ALERT_REDACTED} rejected`],
    ['an xAI key', `key ${FAKE_XAI_KEY} rejected`, `key ${ALERT_REDACTED} rejected`],
    [
      'a bearer credential',
      'Authorization: Bearer fake.xyz-token',
      `Authorization: ${ALERT_REDACTED}`,
    ],
    ['a lowercase bearer credential', 'header bearer xyz', `header ${ALERT_REDACTED}`],
    ['a 32-character hex run', `hash ${FAKE_HEX_32} used`, `hash ${ALERT_REDACTED} used`],
    [
      'an uppercase 32-character hex run',
      `hash ${FAKE_HEX_32.toUpperCase()}`,
      `hash ${ALERT_REDACTED}`,
    ],
  ])('redacts %s', (_label, inputText, expectedText) => {
    // Act
    const actualText = redactText(inputText);

    // Assert
    expect(actualText).toBe(expectedText);
  });

  it('keeps a hex run longer than 32 characters', () => {
    // Arrange
    const inputText = `commit ${FAKE_HEX_40}`;

    // Act
    const actualText = redactText(inputText);

    // Assert
    expect(actualText).toBe(inputText);
  });

  it.each([
    [
      'a user and a password',
      'connect redis://fake-user:fake-pass@redis.example.test:6379 failed',
      `connect redis://${ALERT_REDACTED}@redis.example.test:6379 failed`,
    ],
    [
      'a password with an empty user',
      'redis://:fake-pass@redis.example.test:6379',
      `redis://${ALERT_REDACTED}@redis.example.test:6379`,
    ],
    [
      'an https URL with credentials',
      'https://fake-user:fake-pass@alerts.example.test/alerts',
      `https://${ALERT_REDACTED}@alerts.example.test/alerts`,
    ],
  ])(
    'replaces URL credentials with %s and keeps the scheme and host',
    (_label, inputText, expectedText) => {
      // Act
      const actualText = redactText(inputText);

      // Assert
      expect(actualText).toBe(expectedText);
      expect(actualText).not.toContain('fake-pass');
    },
  );

  it('keeps a URL without credentials unchanged', () => {
    // Arrange
    const inputText = 'GET https://alerts.example.test:8443/alerts failed';

    // Act
    const actualText = redactText(inputText);

    // Assert
    expect(actualText).toBe(inputText);
  });
});

describe('sanitizeMessage', () => {
  it('cuts the message to ALERT_MESSAGE_MAX_CHARS', () => {
    // Arrange
    const inputMessage = 'm'.repeat(ALERT_MESSAGE_MAX_CHARS + 1);

    // Act
    const actualMessage = sanitizeMessage(inputMessage);

    // Assert
    expect(actualMessage).toHaveLength(ALERT_MESSAGE_MAX_CHARS);
  });

  it('redacts secrets in the message', () => {
    // Arrange
    const inputMessage = `login failed for ${FAKE_PHONE} with ${FAKE_SESSION}`;

    // Act
    const actualMessage = sanitizeMessage(inputMessage);

    // Assert
    expect(actualMessage).toBe(`login failed for ${ALERT_REDACTED} with ${ALERT_REDACTED}`);
  });
});

describe('sanitizeDetails', () => {
  it.each([
    'sessionString',
    'session_string',
    'SESSION-STRING',
    'session',
    'phoneNumber',
    'phone_number',
    'phone',
    'phoneCode',
    'password',
    'Password',
    'apiHash',
    'api_hash',
    'apiKey',
    'API_KEY',
    'token',
    'botToken',
    'bot_token',
    'Authorization',
    'secret',
    'SECRET',
    'auth',
    'code',
    'pin',
    'pass',
    'pwd',
    'hash',
    'key',
    'url',
    'URL',
    'Key',
  ])('drops the forbidden key %s', (inputKey) => {
    // Arrange
    const inputDetails = { [inputKey]: 'fake-value', kept: 'yes' };

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toEqual({ kept: 'yes' });
  });

  it.each([
    'X-API-Key',
    'accessToken',
    'apiSecret',
    'clientSecret',
    'sessionId',
    'userPhone',
    'userPasswd',
    'credentials',
    'Set-Cookie',
    'encryptionKey',
    'REDIS_URL',
    'sentryDsn',
    'otpCode',
  ])('drops the key %s that contains a forbidden fragment', (inputKey) => {
    // Arrange
    const inputDetails = { [inputKey]: 'fake-value', kept: 'yes' };

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toEqual({ kept: 'yes' });
  });

  it('keeps ordinary keys that contain no forbidden fragment', () => {
    // Arrange
    const inputDetails = {
      userId: INPUT_BARE_ID,
      username: 'fake_user',
      has2fa: true,
      isPersisted: false,
      status: 'failed',
      reason: 'fake reason',
      operation: 'getMe',
    };

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toEqual(inputDetails);
  });

  it('keeps every details key the service reports, including ones close to an exact forbidden key', () => {
    // Arrange
    const inputDetails = {
      urls: ['/telegram/me'],
      status: 503,
      operation: 'Posts',
      channel: 'fake_channel',
      trigger: 'schedule',
      reason: 'fake reason',
      cause: '503',
      missing: ['GROK_API_KEY'],
      userId: INPUT_BARE_ID,
      username: 'fake_user',
      has2fa: true,
      isPersisted: false,
      unavailableChannels: ['fake_a'],
      truncatedChannels: ['fake_b'],
      untranslatedCount: 1,
      skippedPostCount: 2,
      fallbackTopicCount: 3,
      suppressedRepeats: 4,
      droppedAlerts: 5,
      cron: '0 23 * * *',
    };

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toEqual(inputDetails);
  });

  it.each([
    ['a Buffer', Buffer.from('fake-bytes')],
    ['an Error', new Error('fake error with ' + FAKE_PHONE)],
    ['a Map', new Map([['password', 'fake-value']])],
    ['a Set', new Set(['fake-value'])],
    [
      'a class instance',
      new (class FakeHolder {
        readonly inner = 'fake-value';
      })(),
    ],
  ])('replaces %s with the unsupported marker', (_label, inputValue) => {
    // Act
    const actualDetails = sanitizeDetails({ value: inputValue, kept: 'yes' });

    // Assert
    expect(actualDetails).toEqual({ value: '[unsupported]', kept: 'yes' });
  });

  it('replaces a non-plain object inside an array with the unsupported marker', () => {
    // Act
    const actualDetails = sanitizeDetails({ list: [new Error('fake'), 'a'] });

    // Assert
    expect(actualDetails).toEqual({ list: ['[unsupported]', 'a'] });
  });

  it('recurses into an object without a prototype and still drops forbidden keys', () => {
    // Arrange
    const inputNested = Object.assign(Object.create(null) as Record<string, unknown>, {
      password: FAKE_PASSWORD,
      path: '/telegram/me',
    });

    // Act
    const actualDetails = sanitizeDetails({ request: inputNested });

    // Assert
    expect(actualDetails).toEqual({ request: { path: '/telegram/me' } });
  });

  it('drops forbidden keys in nested objects', () => {
    // Arrange
    const inputDetails = { request: { password: FAKE_PASSWORD, path: '/telegram/me' } };

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toEqual({ request: { path: '/telegram/me' } });
  });

  it('redacts secrets in nested strings and arrays but keeps bare ids', () => {
    // Arrange
    const inputDetails = {
      note: `user ${FAKE_PHONE}`,
      nested: { raw: FAKE_SESSION, list: [`s:${FAKE_SESSION}`, INPUT_BARE_ID] },
      channelId: INPUT_BARE_ID,
    };

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toEqual({
      note: `user ${ALERT_REDACTED}`,
      nested: { raw: ALERT_REDACTED, list: [`s:${ALERT_REDACTED}`, INPUT_BARE_ID] },
      channelId: INPUT_BARE_ID,
    });
  });

  it('replaces values nested beyond ALERT_DETAILS_MAX_DEPTH with ALERT_TOO_DEEP', () => {
    // Arrange
    const inputDetails = { l1: { l2: { l3: { l4: 'deep' }, value: 'kept' } } };

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(ALERT_DETAILS_MAX_DEPTH).toBe(3);
    expect(actualDetails).toEqual({ l1: { l2: { l3: ALERT_TOO_DEEP, value: 'kept' } } });
  });

  it('counts array nesting toward the depth limit', () => {
    // Arrange
    const inputDetails = { l1: [[['deep']]] };

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toEqual({ l1: [[ALERT_TOO_DEEP]] });
  });

  it('cuts arrays to ALERT_DETAILS_MAX_ITEMS', () => {
    // Arrange
    const inputItems = Array.from(
      { length: ALERT_DETAILS_MAX_ITEMS + 5 },
      (_value, index) => index,
    );

    // Act
    const actualDetails = sanitizeDetails({ items: inputItems });

    // Assert
    expect(actualDetails?.items).toEqual(inputItems.slice(0, ALERT_DETAILS_MAX_ITEMS));
  });

  it('drops functions, undefined and symbols, in objects and arrays', () => {
    // Arrange
    const inputDetails = {
      fn: () => 'x',
      missing: undefined,
      sym: Symbol('fake'),
      big: BigInt(1),
      list: [1, undefined, () => 'x', Symbol('fake'), 'a'],
      [Symbol('key')]: 'hidden',
      kept: true,
    };

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toEqual({ list: [1, 'a'], kept: true });
  });

  it('keeps null, booleans and finite numbers, and turns NaN and Infinity into strings', () => {
    // Arrange
    const inputDetails = {
      empty: null,
      flag: false,
      count: 7,
      notNumber: NaN,
      positive: Infinity,
      negative: -Infinity,
    };

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toEqual({
      empty: null,
      flag: false,
      count: 7,
      notNumber: 'NaN',
      positive: 'Infinity',
      negative: '-Infinity',
    });
  });

  it('turns a Date into its ISO string and an invalid Date into null', () => {
    // Arrange
    const inputDate = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));

    // Act
    const actualDetails = sanitizeDetails({ at: inputDate, bad: new Date(NaN) });

    // Assert
    expect(actualDetails).toEqual({ at: inputDate.toISOString(), bad: null });
  });

  it('replaces details serialized beyond ALERT_DETAILS_MAX_CHARS with a truncated preview', () => {
    // Arrange
    const inputDetails = { blob: 'x'.repeat(ALERT_DETAILS_MAX_CHARS) };
    const expectedPreview = JSON.stringify(inputDetails).slice(0, ALERT_DETAILS_MAX_CHARS);

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toEqual({ truncated: true, preview: expectedPreview });
    expect((actualDetails?.preview as string).length).toBe(ALERT_DETAILS_MAX_CHARS);
  });

  it('keeps details whose serialized form is exactly ALERT_DETAILS_MAX_CHARS', () => {
    // Arrange
    const overheadChars = JSON.stringify({ blob: '' }).length;
    const inputDetails = { blob: 'x'.repeat(ALERT_DETAILS_MAX_CHARS - overheadChars) };

    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toEqual(inputDetails);
  });

  it.each([
    ['empty', {}],
    ['only forbidden keys', { password: FAKE_PASSWORD, token: FAKE_BOT_TOKEN }],
    ['only dropped values', { fn: () => 'x', missing: undefined }],
  ])('returns undefined for %s details', (_label, inputDetails) => {
    // Act
    const actualDetails = sanitizeDetails(inputDetails);

    // Assert
    expect(actualDetails).toBeUndefined();
  });
});

describe('buildAlertPayload', () => {
  it('builds the payload with a sanitized message and details', () => {
    // Arrange
    const inputMessage = `failed for ${FAKE_PHONE}`;

    // Act
    const actualPayload = buildAlertPayload('fake-service', 'error', inputMessage, {
      attempt: 2,
      phone: FAKE_PHONE,
    });

    // Assert
    expect(actualPayload).toEqual({
      serviceName: 'fake-service',
      level: 'error',
      message: `failed for ${ALERT_REDACTED}`,
      details: { attempt: 2 },
    });
  });

  it.each([
    ['no details', undefined],
    ['empty details', {}],
    ['details reduced to nothing', { apiKey: FAKE_API_KEY }],
  ])('omits the details key with %s', (_label, inputDetails) => {
    // Act
    const actualPayload = buildAlertPayload('fake-service', 'info', 'hello', inputDetails);

    // Assert
    expect(actualPayload).toEqual({ serviceName: 'fake-service', level: 'info', message: 'hello' });
    expect(Object.keys(actualPayload)).not.toContain('details');
  });

  it('never serializes any fake secret supplied in details or the message', () => {
    // Arrange
    const inputDetails = {
      sessionString: FAKE_SESSION,
      session_string: FAKE_SESSION,
      phoneNumber: FAKE_PHONE,
      phone: FAKE_PHONE,
      phoneCode: FAKE_PHONE_CODE,
      password: FAKE_PASSWORD,
      apiHash: FAKE_API_HASH,
      apiKey: FAKE_API_KEY,
      token: FAKE_BOT_TOKEN,
      botToken: FAKE_BOT_TOKEN,
      Authorization: FAKE_AUTHORIZATION,
      secret: FAKE_SECRET,
      nested: {
        note: `retry with ${FAKE_SESSION} for ${FAKE_PHONE}`,
        headers: { authorization: FAKE_AUTHORIZATION, 'x-api-key': FAKE_API_KEY },
        list: [FAKE_SESSION, { password: FAKE_PASSWORD }],
      },
    };

    // Act
    const actualSerialized = JSON.stringify(
      buildAlertPayload('fake-service', 'error', `session ${FAKE_SESSION}`, inputDetails),
    );

    // Assert
    [
      FAKE_SESSION,
      FAKE_PHONE,
      FAKE_API_KEY,
      FAKE_PASSWORD,
      FAKE_BOT_TOKEN,
      FAKE_API_HASH,
      FAKE_PHONE_CODE,
      FAKE_SECRET,
      FAKE_AUTHORIZATION,
    ].forEach((secret) => expect(actualSerialized).not.toContain(secret));
    expect(actualSerialized).toContain(ALERT_REDACTED);
  });
});
