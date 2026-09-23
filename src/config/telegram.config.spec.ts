import { Logger } from '@nestjs/common';
import { getTelegramConfig } from './telegram.config';

const INPUT_API_ID = 12345;
const INPUT_API_HASH = 'fake-api-hash';

describe('getTelegramConfig', () => {
  const originalEnv = process.env;
  let warnSpy: jest.SpyInstance;
  let consoleSpies: jest.SpyInstance[];

  beforeEach(() => {
    process.env = { ...originalEnv };
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    consoleSpies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  function expectNoConsoleOutput(): void {
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  }

  it('parses the api id as a number and reads the hash, without warning', () => {
    // Arrange
    process.env.TELEGRAM_API_ID = String(INPUT_API_ID);
    process.env.TELEGRAM_API_HASH = INPUT_API_HASH;

    // Act
    const actualResult = getTelegramConfig();

    // Assert
    expect(actualResult).toEqual({ apiId: INPUT_API_ID, apiHash: INPUT_API_HASH });
    expect(warnSpy).not.toHaveBeenCalled();
    expectNoConsoleOutput();
  });

  it('returns apiId 0 and warns once through the Logger when the api id is missing', () => {
    // Arrange
    delete process.env.TELEGRAM_API_ID;
    process.env.TELEGRAM_API_HASH = INPUT_API_HASH;

    // Act
    const actualResult = getTelegramConfig();

    // Assert
    expect(actualResult).toEqual({ apiId: 0, apiHash: INPUT_API_HASH });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_API_ID'));
    expectNoConsoleOutput();
  });

  it('warns when the api id is not numeric', () => {
    // Arrange
    process.env.TELEGRAM_API_ID = 'not-a-number';
    process.env.TELEGRAM_API_HASH = INPUT_API_HASH;

    // Act
    getTelegramConfig();

    // Assert
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_API_ID'));
  });

  it('returns an empty hash and warns once through the Logger when the api hash is missing', () => {
    // Arrange
    process.env.TELEGRAM_API_ID = String(INPUT_API_ID);
    delete process.env.TELEGRAM_API_HASH;

    // Act
    const actualResult = getTelegramConfig();

    // Assert
    expect(actualResult).toEqual({ apiId: INPUT_API_ID, apiHash: '' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_API_HASH'));
    expectNoConsoleOutput();
  });

  it('warns for both variables when both are missing', () => {
    // Arrange
    delete process.env.TELEGRAM_API_ID;
    delete process.env.TELEGRAM_API_HASH;
    const expectedWarnCount = 2;

    // Act
    const actualResult = getTelegramConfig();

    // Assert
    expect(actualResult).toEqual({ apiId: 0, apiHash: '' });
    expect(warnSpy).toHaveBeenCalledTimes(expectedWarnCount);
    expectNoConsoleOutput();
  });

  it('logs plain ASCII warnings (no emoji)', () => {
    // Arrange
    delete process.env.TELEGRAM_API_ID;
    delete process.env.TELEGRAM_API_HASH;

    // Act
    getTelegramConfig();

    // Assert
    const actualText = warnSpy.mock.calls.flat().map(String).join('\n');
    expect(actualText).toMatch(/^[\x20-\x7E\n]+$/);
  });
});
