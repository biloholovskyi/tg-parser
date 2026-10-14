import { Logger } from '@nestjs/common';
import {
  DIGEST_CHANNELS_ENV_VAR,
  DIGEST_CRON_DEFAULT,
  DIGEST_CRON_ENV_VAR,
  DIGEST_MAX_CHANNELS,
  DIGEST_TIMEZONE_DEFAULT,
  DIGEST_TIMEZONE_ENV_VAR,
  DIGEST_TRANSLATION_DEFAULT,
  DIGEST_TRANSLATION_ENV_VAR,
  DIGEST_TRANSLATION_MODES,
  GROK_API_KEY_ENV_VAR,
  GROK_MODEL_DEFAULT,
  GROK_MODEL_ENV_VAR,
  GROK_REASONING_EFFORT_DEFAULT,
  GROK_REASONING_EFFORT_ENV_VAR,
  GROK_REASONING_EFFORTS,
  GROK_TRANSLATION_MODEL_DEFAULT,
  GROK_TRANSLATION_MODEL_ENV_VAR,
  GROK_TRANSLATION_REASONING_EFFORT_DEFAULT,
  GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR,
  TELEGRAM_BOT_CHAT_ID_ENV_VAR,
  TELEGRAM_BOT_TOKEN_ENV_VAR,
  getDigestConfig,
  missingDigestVariables,
} from './digest.config';

const ALL_ENV_VARS = [
  DIGEST_CHANNELS_ENV_VAR,
  DIGEST_CRON_ENV_VAR,
  DIGEST_TIMEZONE_ENV_VAR,
  GROK_API_KEY_ENV_VAR,
  GROK_MODEL_ENV_VAR,
  GROK_REASONING_EFFORT_ENV_VAR,
  DIGEST_TRANSLATION_ENV_VAR,
  GROK_TRANSLATION_MODEL_ENV_VAR,
  GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR,
  TELEGRAM_BOT_TOKEN_ENV_VAR,
  TELEGRAM_BOT_CHAT_ID_ENV_VAR,
];

const inputGrokKey = 'fake-grok-api-key';
const inputBotToken = '000000:fake-bot-token';
const inputBotChatId = '-100000000000';
const inputChannels = 'fake_channel_one,fake_channel_two';
const CHANNEL_INDEX_WIDTH = 3;
const EXTRA_CHANNELS_COUNT = 1;

/** An obviously fake, valid channel username unique per index. */
function buildChannelName(index: number): string {
  return `fake_chan_${String(index).padStart(CHANNEL_INDEX_WIDTH, '0')}`;
}

function buildChannelList(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => buildChannelName(index));
}

function setCompleteEnv(): void {
  process.env[DIGEST_CHANNELS_ENV_VAR] = inputChannels;
  process.env[GROK_API_KEY_ENV_VAR] = inputGrokKey;
  process.env[TELEGRAM_BOT_TOKEN_ENV_VAR] = inputBotToken;
  process.env[TELEGRAM_BOT_CHAT_ID_ENV_VAR] = inputBotChatId;
}

describe('getDigestConfig', () => {
  const originalEnv = new Map(ALL_ENV_VARS.map((name) => [name, process.env[name]]));
  let mockWarn: jest.SpyInstance;

  function warnings(): string[] {
    return mockWarn.mock.calls.map((call: unknown[]) => call.map(String).join(' '));
  }

  beforeEach(() => {
    for (const name of ALL_ENV_VARS) {
      delete process.env[name];
    }
    mockWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const [name, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  describe('channels', () => {
    it('parses a comma-separated list, trimming spaces and a leading @', () => {
      // Arrange
      setCompleteEnv();
      process.env[DIGEST_CHANNELS_ENV_VAR] = '  fake_channel_one , @fake_channel_two ,, ';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.channels).toEqual(['fake_channel_one', 'fake_channel_two']);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it.each([
      ['unset', undefined],
      ['empty', ''],
      ['only separators and spaces', ' , ,  '],
    ])('yields no channels when the list is %s', (_label, inputValue) => {
      // Arrange
      if (inputValue !== undefined) {
        process.env[DIGEST_CHANNELS_ENV_VAR] = inputValue;
      }

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.channels).toEqual([]);
      expect(actualConfig.isConfigured).toBe(false);
    });

    it('skips invalid names with one warning that counts them and does not echo them', () => {
      // Arrange
      setCompleteEnv();
      process.env[DIGEST_CHANNELS_ENV_VAR] =
        'fake_channel_one,1starts_with_digit,shrt,@@double_at,fake-dash-name';
      const expectedInvalidCount = 4;

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.channels).toEqual(['fake_channel_one']);
      const actualChannelWarnings = warnings().filter((line) =>
        line.includes(DIGEST_CHANNELS_ENV_VAR),
      );
      expect(actualChannelWarnings).toHaveLength(1);
      expect(actualChannelWarnings[0]).toContain(String(expectedInvalidCount));
      expect(actualChannelWarnings[0]).not.toContain('1starts_with_digit');
      expect(actualChannelWarnings[0]).not.toContain('fake-dash-name');
    });

    it('removes duplicates case-insensitively and lowercases, with and without @', () => {
      // Arrange
      setCompleteEnv();
      process.env[DIGEST_CHANNELS_ENV_VAR] =
        'Fake_Channel_One,fake_channel_one,@FAKE_CHANNEL_ONE,fake_channel_two';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.channels).toEqual(['fake_channel_one', 'fake_channel_two']);
    });

    it(`keeps exactly DIGEST_MAX_CHANNELS names without a warning`, () => {
      // Arrange
      setCompleteEnv();
      const inputList = buildChannelList(DIGEST_MAX_CHANNELS);
      process.env[DIGEST_CHANNELS_ENV_VAR] = inputList.join(',');

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.channels).toEqual(inputList);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('caps the list at DIGEST_MAX_CHANNELS, keeping the first ones, with one warning', () => {
      // Arrange
      setCompleteEnv();
      const inputList = buildChannelList(DIGEST_MAX_CHANNELS + EXTRA_CHANNELS_COUNT);
      process.env[DIGEST_CHANNELS_ENV_VAR] = inputList.join(',');

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.channels).toEqual(inputList.slice(0, DIGEST_MAX_CHANNELS));
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(warnings()[0]).toContain(String(DIGEST_MAX_CHANNELS));
    });

    it('counts duplicates once before applying the cap', () => {
      // Arrange
      setCompleteEnv();
      const inputList = buildChannelList(DIGEST_MAX_CHANNELS);
      process.env[DIGEST_CHANNELS_ENV_VAR] = [...inputList, inputList[0].toUpperCase()].join(',');

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.channels).toHaveLength(DIGEST_MAX_CHANNELS);
      expect(mockWarn).not.toHaveBeenCalled();
    });
  });

  describe('defaults and overrides', () => {
    it('falls back to the defaults for cron, timezone and model', () => {
      // Arrange
      setCompleteEnv();

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.cron).toBe(DIGEST_CRON_DEFAULT);
      expect(actualConfig.timezone).toBe(DIGEST_TIMEZONE_DEFAULT);
      expect(actualConfig.grokModel).toBe(GROK_MODEL_DEFAULT);
    });

    it('treats whitespace-only overrides as unset', () => {
      // Arrange
      setCompleteEnv();
      process.env[DIGEST_CRON_ENV_VAR] = '   ';
      process.env[DIGEST_TIMEZONE_ENV_VAR] = ' ';
      process.env[GROK_MODEL_ENV_VAR] = '  ';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.cron).toBe(DIGEST_CRON_DEFAULT);
      expect(actualConfig.timezone).toBe(DIGEST_TIMEZONE_DEFAULT);
      expect(actualConfig.grokModel).toBe(GROK_MODEL_DEFAULT);
    });

    it('uses trimmed overrides and returns every value', () => {
      // Arrange
      setCompleteEnv();
      const expectedCron = '0 7 * * *';
      const expectedTimezone = 'UTC';
      const expectedModel = 'fake-grok-model';
      process.env[DIGEST_CRON_ENV_VAR] = ` ${expectedCron} `;
      process.env[DIGEST_TIMEZONE_ENV_VAR] = ` ${expectedTimezone} `;
      process.env[GROK_MODEL_ENV_VAR] = ` ${expectedModel} `;
      process.env[GROK_API_KEY_ENV_VAR] = ` ${inputGrokKey} `;

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig).toEqual({
        channels: ['fake_channel_one', 'fake_channel_two'],
        cron: expectedCron,
        timezone: expectedTimezone,
        grokApiKey: inputGrokKey,
        grokModel: expectedModel,
        grokReasoningEffort: GROK_REASONING_EFFORT_DEFAULT,
        translationMode: DIGEST_TRANSLATION_DEFAULT,
        grokTranslationModel: GROK_TRANSLATION_MODEL_DEFAULT,
        grokTranslationReasoningEffort: GROK_TRANSLATION_REASONING_EFFORT_DEFAULT,
        botToken: inputBotToken,
        botChatId: inputBotChatId,
        isConfigured: true,
      });
    });
  });

  describe('grokReasoningEffort', () => {
    it('defaults to low without a warning when unset', () => {
      // Arrange
      setCompleteEnv();

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(GROK_REASONING_EFFORT_DEFAULT).toBe('low');
      expect(actualConfig.grokReasoningEffort).toBe(GROK_REASONING_EFFORT_DEFAULT);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('treats a whitespace-only value as unset', () => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_REASONING_EFFORT_ENV_VAR] = '   ';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.grokReasoningEffort).toBe(GROK_REASONING_EFFORT_DEFAULT);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('allows exactly low, medium, high, xhigh and off', () => {
      // Assert
      expect([...GROK_REASONING_EFFORTS]).toEqual(['low', 'medium', 'high', 'xhigh', 'off']);
    });

    it.each([...GROK_REASONING_EFFORTS])('accepts %s without a warning', (inputEffort) => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_REASONING_EFFORT_ENV_VAR] = inputEffort;

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.grokReasoningEffort).toBe(inputEffort);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it.each([
      ['HIGH', 'high'],
      ['XHigh', 'xhigh'],
      ['Off', 'off'],
      [' Medium ', 'medium'],
    ])('accepts %p case-insensitively and trimmed as %s', (inputRaw, expectedEffort) => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_REASONING_EFFORT_ENV_VAR] = inputRaw;

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.grokReasoningEffort).toBe(expectedEffort);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('falls back to the default with one warning naming the variable for an unknown value', () => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_REASONING_EFFORT_ENV_VAR] = 'maximum';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.grokReasoningEffort).toBe(GROK_REASONING_EFFORT_DEFAULT);
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(warnings()[0]).toContain(GROK_REASONING_EFFORT_ENV_VAR);
      expect(warnings()[0]).toContain('maximum');
      expect(warnings()[0]).toContain(GROK_REASONING_EFFORT_DEFAULT);
    });

    it('never puts a secret into the unknown-effort warning', () => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_REASONING_EFFORT_ENV_VAR] = 'bogus';

      // Act
      getDigestConfig();

      // Assert
      const actualText = warnings().join(' | ');
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(actualText).not.toContain(inputGrokKey);
      expect(actualText).not.toContain(inputBotToken);
      expect(actualText).not.toContain(inputBotChatId);
    });

    it('does not let an invalid effort affect isConfigured', () => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_REASONING_EFFORT_ENV_VAR] = 'bogus';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.isConfigured).toBe(true);
    });
  });

  describe('translationMode', () => {
    it('defaults to off without a warning when unset', () => {
      // Arrange
      setCompleteEnv();

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(DIGEST_TRANSLATION_DEFAULT).toBe('off');
      expect(actualConfig.translationMode).toBe('off');
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('allows exactly off and on', () => {
      // Assert
      expect([...DIGEST_TRANSLATION_MODES]).toEqual(['off', 'on']);
    });

    it.each([
      ['off', 'off'],
      ['on', 'on'],
      ['ON', 'on'],
      [' On ', 'on'],
      ['OFF', 'off'],
    ])('accepts %p case-insensitively and trimmed as %s', (inputRaw, expectedMode) => {
      // Arrange
      setCompleteEnv();
      process.env[DIGEST_TRANSLATION_ENV_VAR] = inputRaw;

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.translationMode).toBe(expectedMode);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('falls back to off with one warning naming the variable for an unknown value', () => {
      // Arrange
      setCompleteEnv();
      process.env[DIGEST_TRANSLATION_ENV_VAR] = 'always';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      const actualText = warnings().join(' | ');
      expect(actualConfig.translationMode).toBe(DIGEST_TRANSLATION_DEFAULT);
      expect(actualConfig.isConfigured).toBe(true);
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(actualText).toContain(DIGEST_TRANSLATION_ENV_VAR);
      expect(actualText).toContain('always');
      expect(actualText).not.toContain(inputGrokKey);
      expect(actualText).not.toContain(inputBotToken);
      expect(actualText).not.toContain(inputBotChatId);
    });
  });

  describe('grokTranslationModel', () => {
    it('defaults to GROK_TRANSLATION_MODEL_DEFAULT, not to GROK_MODEL', () => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_MODEL_ENV_VAR] = 'fake-main-model';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(GROK_TRANSLATION_MODEL_DEFAULT).toBe('grok-4.20-0309-non-reasoning');
      expect(actualConfig.grokTranslationModel).toBe(GROK_TRANSLATION_MODEL_DEFAULT);
      expect(actualConfig.grokModel).toBe('fake-main-model');
    });

    it('treats a whitespace-only value as unset', () => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_TRANSLATION_MODEL_ENV_VAR] = '   ';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.grokTranslationModel).toBe(GROK_TRANSLATION_MODEL_DEFAULT);
    });

    it('uses a trimmed override and leaves GROK_MODEL at its default', () => {
      // Arrange
      setCompleteEnv();
      const expectedModel = 'fake-translation-model';
      process.env[GROK_TRANSLATION_MODEL_ENV_VAR] = ` ${expectedModel} `;

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.grokTranslationModel).toBe(expectedModel);
      expect(actualConfig.grokModel).toBe(GROK_MODEL_DEFAULT);
      expect(mockWarn).not.toHaveBeenCalled();
    });
  });

  describe('grokTranslationReasoningEffort', () => {
    it('defaults to off without a warning when unset', () => {
      // Arrange
      setCompleteEnv();

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(GROK_TRANSLATION_REASONING_EFFORT_DEFAULT).toBe('off');
      expect(actualConfig.grokTranslationReasoningEffort).toBe('off');
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it.each([...GROK_REASONING_EFFORTS])('accepts %s without a warning', (inputEffort) => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR] = inputEffort;

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.grokTranslationReasoningEffort).toBe(inputEffort);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it.each([
      ['LOW', 'low'],
      [' XHigh ', 'xhigh'],
    ])('accepts %p case-insensitively and trimmed as %s', (inputRaw, expectedEffort) => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR] = inputRaw;

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.grokTranslationReasoningEffort).toBe(expectedEffort);
    });

    it('falls back to off with one warning naming the variable for an unknown value', () => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR] = 'maximum';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      const actualText = warnings().join(' | ');
      expect(actualConfig.grokTranslationReasoningEffort).toBe(
        GROK_TRANSLATION_REASONING_EFFORT_DEFAULT,
      );
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(actualText).toContain(GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR);
      expect(actualText).not.toContain(inputGrokKey);
      expect(actualText).not.toContain(inputBotToken);
    });

    it('is parsed independently of GROK_REASONING_EFFORT', () => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_REASONING_EFFORT_ENV_VAR] = 'high';
      process.env[GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR] = 'bogus';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.grokReasoningEffort).toBe('high');
      expect(actualConfig.grokTranslationReasoningEffort).toBe(
        GROK_TRANSLATION_REASONING_EFFORT_DEFAULT,
      );
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(warnings()[0]).toContain(GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR);
    });
  });

  it('warns once per unknown variable when all three choices are unknown', () => {
    // Arrange
    setCompleteEnv();
    process.env[GROK_REASONING_EFFORT_ENV_VAR] = 'bogus-one';
    process.env[DIGEST_TRANSLATION_ENV_VAR] = 'bogus-two';
    process.env[GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR] = 'bogus-three';

    // Act
    getDigestConfig();

    // Assert
    const actualWarnings = warnings();
    const expectedVariables = [
      GROK_REASONING_EFFORT_ENV_VAR,
      DIGEST_TRANSLATION_ENV_VAR,
      GROK_TRANSLATION_REASONING_EFFORT_ENV_VAR,
    ];
    expect(actualWarnings).toHaveLength(expectedVariables.length);
    for (const name of expectedVariables) {
      expect(actualWarnings.filter((text) => text.startsWith(`${name}=`))).toHaveLength(1);
    }
  });

  describe('isConfigured', () => {
    it('is true with no warning when channels, Grok key and bot target are set', () => {
      // Arrange
      setCompleteEnv();

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.isConfigured).toBe(true);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it.each([
      DIGEST_CHANNELS_ENV_VAR,
      GROK_API_KEY_ENV_VAR,
      TELEGRAM_BOT_TOKEN_ENV_VAR,
      TELEGRAM_BOT_CHAT_ID_ENV_VAR,
    ])('is false with one warning naming %s when it is missing', (inputMissing) => {
      // Arrange
      setCompleteEnv();
      delete process.env[inputMissing];

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.isConfigured).toBe(false);
      expect(mockWarn).toHaveBeenCalledTimes(1);
      expect(warnings()[0]).toContain(inputMissing);
    });

    it('is false when every channel name is invalid', () => {
      // Arrange
      setCompleteEnv();
      process.env[DIGEST_CHANNELS_ENV_VAR] = '1bad,x';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.channels).toEqual([]);
      expect(actualConfig.isConfigured).toBe(false);
      expect(warnings().join(' | ')).toContain(DIGEST_CHANNELS_ENV_VAR);
    });

    it('names every missing variable in the warning when nothing is set', () => {
      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.isConfigured).toBe(false);
      expect(mockWarn).toHaveBeenCalledTimes(1);
      for (const name of [
        DIGEST_CHANNELS_ENV_VAR,
        GROK_API_KEY_ENV_VAR,
        TELEGRAM_BOT_TOKEN_ENV_VAR,
        TELEGRAM_BOT_CHAT_ID_ENV_VAR,
      ]) {
        expect(warnings()[0]).toContain(name);
      }
    });

    it('never puts the Grok key, bot token or chat id into a warning', () => {
      // Arrange
      process.env[GROK_API_KEY_ENV_VAR] = inputGrokKey;
      process.env[TELEGRAM_BOT_TOKEN_ENV_VAR] = inputBotToken;
      process.env[TELEGRAM_BOT_CHAT_ID_ENV_VAR] = inputBotChatId;

      // Act
      getDigestConfig();

      // Assert
      const actualText = warnings().join(' | ');
      expect(mockWarn).toHaveBeenCalled();
      expect(actualText).not.toContain(inputGrokKey);
      expect(actualText).not.toContain(inputBotToken);
      expect(actualText).not.toContain(inputBotChatId);
    });

    it('treats whitespace-only secrets as missing', () => {
      // Arrange
      setCompleteEnv();
      process.env[GROK_API_KEY_ENV_VAR] = '   ';

      // Act
      const actualConfig = getDigestConfig();

      // Assert
      expect(actualConfig.isConfigured).toBe(false);
      expect(actualConfig.grokApiKey).toBe('');
      expect(warnings()[0]).toContain(GROK_API_KEY_ENV_VAR);
    });
  });
});

describe('missingDigestVariables', () => {
  function buildSettings(
    overrides: Partial<Parameters<typeof missingDigestVariables>[0]> = {},
  ): Parameters<typeof missingDigestVariables>[0] {
    return {
      channels: ['fake_channel_one'],
      cron: DIGEST_CRON_DEFAULT,
      timezone: DIGEST_TIMEZONE_DEFAULT,
      grokApiKey: inputGrokKey,
      grokModel: GROK_MODEL_DEFAULT,
      grokReasoningEffort: GROK_REASONING_EFFORT_DEFAULT,
      translationMode: DIGEST_TRANSLATION_DEFAULT,
      grokTranslationModel: GROK_TRANSLATION_MODEL_DEFAULT,
      grokTranslationReasoningEffort: GROK_TRANSLATION_REASONING_EFFORT_DEFAULT,
      botToken: inputBotToken,
      botChatId: inputBotChatId,
      ...overrides,
    };
  }

  it('returns an empty list when every required setting is present', () => {
    // Arrange
    const inputSettings = buildSettings();

    // Act
    const actualMissing = missingDigestVariables(inputSettings);

    // Assert
    expect(actualMissing).toEqual([]);
  });

  it.each([
    [DIGEST_CHANNELS_ENV_VAR, { channels: [] }],
    [GROK_API_KEY_ENV_VAR, { grokApiKey: '' }],
    [TELEGRAM_BOT_TOKEN_ENV_VAR, { botToken: '' }],
    [TELEGRAM_BOT_CHAT_ID_ENV_VAR, { botChatId: '' }],
  ])('names %s alone when only it is missing', (expectedName, inputOverrides) => {
    // Arrange
    const inputSettings = buildSettings(inputOverrides);

    // Act
    const actualMissing = missingDigestVariables(inputSettings);

    // Assert
    expect(actualMissing).toEqual([expectedName]);
  });

  it('names every missing variable in a fixed order and never a value', () => {
    // Arrange
    const inputSettings = buildSettings({
      channels: [],
      grokApiKey: '',
      botToken: '',
      botChatId: '',
    });

    // Act
    const actualMissing = missingDigestVariables(inputSettings);

    // Assert
    expect(actualMissing).toEqual([
      DIGEST_CHANNELS_ENV_VAR,
      GROK_API_KEY_ENV_VAR,
      TELEGRAM_BOT_TOKEN_ENV_VAR,
      TELEGRAM_BOT_CHAT_ID_ENV_VAR,
    ]);
  });

  it('returns names only, without the values of the settings that are present', () => {
    // Arrange
    const inputSettings = buildSettings({ channels: [] });

    // Act
    const actualText = missingDigestVariables(inputSettings).join(',');

    // Assert
    expect(actualText).not.toContain(inputGrokKey);
    expect(actualText).not.toContain(inputBotToken);
    expect(actualText).not.toContain(inputBotChatId);
  });
});
