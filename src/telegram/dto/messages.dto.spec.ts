import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CHANNEL_USERNAME_MAX_LENGTH,
  CHANNEL_USERNAME_MIN_LENGTH,
  ChannelPostsParamsDto,
  GetPostsQueryDto,
  HOURS_BACK_DEFAULT,
  HOURS_BACK_MAX,
  HOURS_BACK_MIN,
} from './messages.dto';

const OUT_OF_RANGE_STEP = 1;
const FIRST_CHARACTER_LENGTH = 1;
const USERNAME_PREFIX = '@';
const INPUT_FRACTIONAL_HOURS_BACK = '1.5';
const INPUT_NON_NUMERIC_HOURS_BACK = 'many';

/** Builds an obviously fake channel username of an exact length, first character a letter. */
function buildChannelUsername(length: number): string {
  return `c${'h'.repeat(length - FIRST_CHARACTER_LENGTH)}`;
}

/**
 * Mirrors the production pipe: `buildValidationPipe` sets no `transformOptions`,
 * so no implicit type conversion happens here either.
 */
function buildParamsDto(inputPlain: Record<string, unknown>): ChannelPostsParamsDto {
  return plainToInstance(ChannelPostsParamsDto, inputPlain);
}

function buildQueryDto(inputPlain: Record<string, unknown>): GetPostsQueryDto {
  return plainToInstance(GetPostsQueryDto, inputPlain);
}

describe('ChannelPostsParamsDto', () => {
  it('accepts a plain channel username of the minimum length', async () => {
    const inputPlain = { channelUsername: buildChannelUsername(CHANNEL_USERNAME_MIN_LENGTH) };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    expect(actualErrors).toHaveLength(0);
  });

  it('accepts a channel username of the maximum length', async () => {
    const inputPlain = { channelUsername: buildChannelUsername(CHANNEL_USERNAME_MAX_LENGTH) };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    expect(actualErrors).toHaveLength(0);
  });

  it('accepts a channel username carrying the leading at sign', async () => {
    const inputPlain = {
      channelUsername: `${USERNAME_PREFIX}${buildChannelUsername(CHANNEL_USERNAME_MIN_LENGTH)}`,
    };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    expect(actualErrors).toHaveLength(0);
  });

  it('accepts a channel username containing digits and underscores after the first letter', async () => {
    const inputPlain = { channelUsername: 'c_h4nnel_1' };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    expect(actualErrors).toHaveLength(0);
  });

  it('rejects a channel username shorter than the minimum length', async () => {
    const inputPlain = {
      channelUsername: buildChannelUsername(CHANNEL_USERNAME_MIN_LENGTH - OUT_OF_RANGE_STEP),
    };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    const expectedError = actualErrors.find((error) => error.property === 'channelUsername');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('matches');
  });

  it('rejects a channel username longer than the maximum length', async () => {
    const inputPlain = {
      channelUsername: buildChannelUsername(CHANNEL_USERNAME_MAX_LENGTH + OUT_OF_RANGE_STEP),
    };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    const expectedError = actualErrors.find((error) => error.property === 'channelUsername');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('matches');
  });

  it('rejects a channel username that starts with a digit', async () => {
    const inputPlain = { channelUsername: '1channel' };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    expect(actualErrors.map((error) => error.property)).toContain('channelUsername');
  });

  it('rejects a channel username that starts with an underscore', async () => {
    const inputPlain = { channelUsername: '_channel' };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    expect(actualErrors.map((error) => error.property)).toContain('channelUsername');
  });

  it('rejects a channel username containing punctuation', async () => {
    const inputPlain = { channelUsername: 'chan.nel' };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    expect(actualErrors.map((error) => error.property)).toContain('channelUsername');
  });

  it('rejects a channel username containing a path separator', async () => {
    const inputPlain = { channelUsername: 'chan/nel' };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    expect(actualErrors.map((error) => error.property)).toContain('channelUsername');
  });

  it('rejects an empty channel username', async () => {
    const inputPlain = { channelUsername: '' };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    expect(actualErrors.map((error) => error.property)).toContain('channelUsername');
  });

  it('rejects a missing channel username', async () => {
    const inputPlain = {};

    const actualErrors = await validate(buildParamsDto(inputPlain));

    expect(actualErrors.map((error) => error.property)).toContain('channelUsername');
  });

  it('rejects a lone at sign without a username behind it', async () => {
    const inputPlain = { channelUsername: USERNAME_PREFIX };

    const actualErrors = await validate(buildParamsDto(inputPlain));

    expect(actualErrors.map((error) => error.property)).toContain('channelUsername');
  });
});

describe('GetPostsQueryDto', () => {
  it('transforms a numeric string into a number', async () => {
    const inputPlain = { hoursBack: String(HOURS_BACK_DEFAULT) };

    const actualDto = buildQueryDto(inputPlain);
    const actualErrors = await validate(actualDto);

    expect(actualDto.hoursBack).toBe(HOURS_BACK_DEFAULT);
    expect(actualErrors).toHaveLength(0);
  });

  it('applies the default hours window when it is omitted', async () => {
    const inputPlain = {};

    const actualDto = buildQueryDto(inputPlain);
    const actualErrors = await validate(actualDto);

    expect(actualDto.hoursBack).toBe(HOURS_BACK_DEFAULT);
    expect(actualErrors).toHaveLength(0);
  });

  it('accepts the minimum hours window', async () => {
    const inputPlain = { hoursBack: String(HOURS_BACK_MIN) };

    const actualDto = buildQueryDto(inputPlain);
    const actualErrors = await validate(actualDto);

    expect(actualDto.hoursBack).toBe(HOURS_BACK_MIN);
    expect(actualErrors).toHaveLength(0);
  });

  it('accepts the maximum hours window', async () => {
    const inputPlain = { hoursBack: String(HOURS_BACK_MAX) };

    const actualDto = buildQueryDto(inputPlain);
    const actualErrors = await validate(actualDto);

    expect(actualDto.hoursBack).toBe(HOURS_BACK_MAX);
    expect(actualErrors).toHaveLength(0);
  });

  it('rejects an hours window below the minimum', async () => {
    const inputPlain = { hoursBack: String(HOURS_BACK_MIN - OUT_OF_RANGE_STEP) };

    const actualErrors = await validate(buildQueryDto(inputPlain));

    const expectedError = actualErrors.find((error) => error.property === 'hoursBack');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('min');
  });

  it('rejects an hours window above the maximum', async () => {
    const inputPlain = { hoursBack: String(HOURS_BACK_MAX + OUT_OF_RANGE_STEP) };

    const actualErrors = await validate(buildQueryDto(inputPlain));

    const expectedError = actualErrors.find((error) => error.property === 'hoursBack');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('max');
  });

  it('rejects a non-numeric hours window', async () => {
    const inputPlain = { hoursBack: INPUT_NON_NUMERIC_HOURS_BACK };

    const actualErrors = await validate(buildQueryDto(inputPlain));

    const expectedError = actualErrors.find((error) => error.property === 'hoursBack');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('isInt');
  });

  it('rejects a fractional hours window', async () => {
    const inputPlain = { hoursBack: INPUT_FRACTIONAL_HOURS_BACK };

    const actualErrors = await validate(buildQueryDto(inputPlain));

    const expectedError = actualErrors.find((error) => error.property === 'hoursBack');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('isInt');
  });

  it('rejects an unknown query property under the production pipe settings', async () => {
    const inputPlain = { hoursBack: String(HOURS_BACK_DEFAULT), sessionString: 'fake-session' };

    const actualErrors = await validate(buildQueryDto(inputPlain), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(actualErrors.map((error) => error.property)).toContain('sessionString');
  });
});
