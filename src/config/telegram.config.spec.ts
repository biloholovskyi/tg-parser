import { getTelegramConfig } from './telegram.config';

describe('getTelegramConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('reads the api id and hash from the environment', () => {
    process.env.TELEGRAM_API_ID = '12345';
    process.env.TELEGRAM_API_HASH = 'fake-api-hash';

    const actual = getTelegramConfig();

    expect(actual).toEqual({ apiId: 12345, apiHash: 'fake-api-hash' });
  });

  it('returns empty credentials and warns when the api id is missing', () => {
    delete process.env.TELEGRAM_API_ID;
    process.env.TELEGRAM_API_HASH = 'fake-api-hash';

    const actual = getTelegramConfig();

    expect(actual.apiId).toBe(0);
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns empty credentials and warns when the api hash is missing', () => {
    process.env.TELEGRAM_API_ID = '12345';
    delete process.env.TELEGRAM_API_HASH;

    const actual = getTelegramConfig();

    expect(actual.apiHash).toBe('');
    expect(console.warn).toHaveBeenCalled();
  });
});
