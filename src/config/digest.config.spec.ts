import { Logger } from '@nestjs/common';
import {
  DIGEST_CHANNELS_ENV_VAR,
  DIGEST_CRON_DEFAULT,
  DIGEST_CRON_ENV_VAR,
  DIGEST_MAX_CHANNELS,
  DIGEST_TIMEZONE_DEFAULT,
  DIGEST_TIMEZONE_ENV_VAR,
  GROK_API_KEY_ENV_VAR,
  GROK_MODEL_DEFAULT,
  GROK_MODEL_ENV_VAR,
  TELEGRAM_BOT_CHAT_ID_ENV_VAR,
  TELEGRAM_BOT_TOKEN_ENV_VAR,
  getDigestConfig,
} from './digest.config';

const ALL_ENV_VARS = [
  DIGEST_CHANNELS_ENV_VAR,
  DIGEST_CRON_ENV_VAR,
  DIGEST_TIMEZONE_ENV_VAR,
  GROK_API_KEY_ENV_VAR,
  GROK_MODEL_ENV_VAR,
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
        botToken: inputBotToken,
        botChatId: inputBotChatId,
        isConfigured: true,
      });
    });
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
