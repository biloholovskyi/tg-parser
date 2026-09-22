import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetPostsDto, HOURS_BACK_DEFAULT, HOURS_BACK_MAX, HOURS_BACK_MIN } from './messages.dto';

const INPUT_FAKE_SESSION_STRING = 'fake-session-string';
const OUT_OF_RANGE_STEP = 1;

/**
 * Mirrors the production pipe: `buildValidationPipe` sets no `transformOptions`,
 * so no implicit type conversion happens here either.
 */
function buildGetPostsDto(inputPlain: Record<string, unknown>): GetPostsDto {
  return plainToInstance(GetPostsDto, inputPlain);
}

describe('GetPostsDto', () => {
  it('accepts a session string with an hours window inside the allowed range', async () => {
    const inputPlain = { sessionString: INPUT_FAKE_SESSION_STRING, hoursBack: HOURS_BACK_DEFAULT };

    const actualErrors = await validate(buildGetPostsDto(inputPlain));

    expect(actualErrors).toHaveLength(0);
  });

  it('accepts the minimum hours window', async () => {
    const inputPlain = { sessionString: INPUT_FAKE_SESSION_STRING, hoursBack: HOURS_BACK_MIN };

    const actualErrors = await validate(buildGetPostsDto(inputPlain));

    expect(actualErrors).toHaveLength(0);
  });

  it('accepts the maximum hours window', async () => {
    const inputPlain = { sessionString: INPUT_FAKE_SESSION_STRING, hoursBack: HOURS_BACK_MAX };

    const actualErrors = await validate(buildGetPostsDto(inputPlain));

    expect(actualErrors).toHaveLength(0);
  });

  it('applies the default hours window when it is omitted', async () => {
    const inputPlain = { sessionString: INPUT_FAKE_SESSION_STRING };

    const actualDto = buildGetPostsDto(inputPlain);
    const actualErrors = await validate(actualDto);

    expect(actualDto.hoursBack).toBe(HOURS_BACK_DEFAULT);
    expect(actualErrors).toHaveLength(0);
  });

  it('rejects an empty session string', async () => {
    const inputPlain = { sessionString: '' };

    const actualErrors = await validate(buildGetPostsDto(inputPlain));

    const expectedError = actualErrors.find((error) => error.property === 'sessionString');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('isNotEmpty');
  });

  it('rejects a missing session string', async () => {
    const inputPlain = { hoursBack: HOURS_BACK_DEFAULT };

    const actualErrors = await validate(buildGetPostsDto(inputPlain));

    expect(actualErrors.map((error) => error.property)).toContain('sessionString');
  });

  it('rejects an hours window below the minimum', async () => {
    const inputPlain = {
      sessionString: INPUT_FAKE_SESSION_STRING,
      hoursBack: HOURS_BACK_MIN - OUT_OF_RANGE_STEP,
    };

    const actualErrors = await validate(buildGetPostsDto(inputPlain));

    const expectedError = actualErrors.find((error) => error.property === 'hoursBack');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('min');
  });

  it('rejects an hours window above the maximum', async () => {
    const inputPlain = {
      sessionString: INPUT_FAKE_SESSION_STRING,
      hoursBack: HOURS_BACK_MAX + OUT_OF_RANGE_STEP,
    };

    const actualErrors = await validate(buildGetPostsDto(inputPlain));

    const expectedError = actualErrors.find((error) => error.property === 'hoursBack');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('max');
  });

  it('rejects a non-numeric hours window', async () => {
    const inputPlain = { sessionString: INPUT_FAKE_SESSION_STRING, hoursBack: 'many' };

    const actualErrors = await validate(buildGetPostsDto(inputPlain));

    expect(actualErrors.map((error) => error.property)).toContain('hoursBack');
  });
});
