import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ValidationError } from 'class-validator';
import { CompleteAuthDto, StartAuthDto } from './auth.dto';

const INPUT_FAKE_PHONE_NUMBER = '+10000000000';
const INPUT_FAKE_PHONE_CODE = '00000';
const INPUT_FAKE_PASSWORD = 'fake-password';
const INPUT_BLANK_VALUE = '   ';
const INPUT_PADDED_PASSWORD = '  fake-password  ';
const INPUT_INVALID_PHONE_CODE = 'not-a-code';
const PHONE_NUMBER_TOO_LONG = '+1000000000000000000';
const PHONE_NUMBER_TOO_SHORT = '+100';
const PASSWORD_OVER_MAX_LENGTH = 257;

/**
 * Mirrors the production pipe: `buildValidationPipe` sets no `transformOptions`,
 * so no implicit type conversion happens here either.
 */
function buildCompleteAuthDto(inputPlain: Record<string, unknown>): CompleteAuthDto {
  return plainToInstance(CompleteAuthDto, inputPlain);
}

async function validateCompleteAuth(
  inputPlain: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(buildCompleteAuthDto(inputPlain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('CompleteAuthDto', () => {
  it('accepts a phone number only', async () => {
    const inputPlain = { phoneNumber: INPUT_FAKE_PHONE_NUMBER };

    const actualErrors = await validateCompleteAuth(inputPlain);

    expect(actualErrors).toHaveLength(0);
  });

  it('accepts a phone number together with a phone code', async () => {
    const inputPlain = {
      phoneNumber: INPUT_FAKE_PHONE_NUMBER,
      phoneCode: INPUT_FAKE_PHONE_CODE,
    };

    const actualErrors = await validateCompleteAuth(inputPlain);

    expect(actualErrors).toHaveLength(0);
  });

  it('accepts a phone number, a phone code and a 2FA password', async () => {
    const inputPlain = {
      phoneNumber: INPUT_FAKE_PHONE_NUMBER,
      phoneCode: INPUT_FAKE_PHONE_CODE,
      password: INPUT_FAKE_PASSWORD,
    };

    const actualErrors = await validateCompleteAuth(inputPlain);

    expect(actualErrors).toHaveLength(0);
  });

  it('accepts a phone number without the leading plus sign', async () => {
    const inputPlain = { phoneNumber: '10000000000' };

    const actualErrors = await validateCompleteAuth(inputPlain);

    expect(actualErrors).toHaveLength(0);
  });

  it('rejects a missing phone number', async () => {
    const inputPlain = { phoneCode: INPUT_FAKE_PHONE_CODE };

    const actualErrors = await validateCompleteAuth(inputPlain);

    expect(actualErrors.map((error) => error.property)).toContain('phoneNumber');
  });

  it('rejects an empty phone number', async () => {
    const inputPlain = { phoneNumber: '' };

    const actualErrors = await validateCompleteAuth(inputPlain);

    expect(actualErrors.map((error) => error.property)).toContain('phoneNumber');
  });

  it('rejects a phone number containing letters', async () => {
    const inputPlain = { phoneNumber: '+1000000000a' };

    const actualErrors = await validateCompleteAuth(inputPlain);

    const expectedError = actualErrors.find((error) => error.property === 'phoneNumber');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('matches');
  });

  it('rejects a phone number that is too long', async () => {
    const inputPlain = { phoneNumber: PHONE_NUMBER_TOO_LONG };

    const actualErrors = await validateCompleteAuth(inputPlain);

    expect(actualErrors.map((error) => error.property)).toContain('phoneNumber');
  });

  it('rejects a phone number that is too short', async () => {
    const inputPlain = { phoneNumber: PHONE_NUMBER_TOO_SHORT };

    const actualErrors = await validateCompleteAuth(inputPlain);

    expect(actualErrors.map((error) => error.property)).toContain('phoneNumber');
  });

  it('rejects a non-digit phone code', async () => {
    const inputPlain = {
      phoneNumber: INPUT_FAKE_PHONE_NUMBER,
      phoneCode: INPUT_INVALID_PHONE_CODE,
    };

    const actualErrors = await validateCompleteAuth(inputPlain);

    const expectedError = actualErrors.find((error) => error.property === 'phoneCode');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('matches');
  });

  it('rejects a password longer than the allowed maximum', async () => {
    const inputPlain = {
      phoneNumber: INPUT_FAKE_PHONE_NUMBER,
      password: 'f'.repeat(PASSWORD_OVER_MAX_LENGTH),
    };

    const actualErrors = await validateCompleteAuth(inputPlain);

    const expectedError = actualErrors.find((error) => error.property === 'password');
    expect(expectedError).toBeDefined();
    expect(expectedError.constraints).toHaveProperty('maxLength');
  });

  it('inherits phoneNumber validation from StartAuthDto', async () => {
    const inputPlain = { phoneNumber: 'not-a-phone-number' };

    const actualStartErrors = await validate(plainToInstance(StartAuthDto, inputPlain));
    const actualCompleteErrors = await validateCompleteAuth(inputPlain);

    expect(actualStartErrors.map((error) => error.property)).toEqual(['phoneNumber']);
    expect(actualCompleteErrors.map((error) => error.property)).toEqual(['phoneNumber']);
  });

  describe('2FA password step ordering', () => {
    it('accepts a password sent together with a phone code', async () => {
      const inputPlain = {
        phoneNumber: INPUT_FAKE_PHONE_NUMBER,
        phoneCode: INPUT_FAKE_PHONE_CODE,
        password: INPUT_FAKE_PASSWORD,
      };

      const actualErrors = await validateCompleteAuth(inputPlain);

      expect(actualErrors).toHaveLength(0);
    });

    it('rejects a password sent without a phone code', async () => {
      const inputPlain = {
        phoneNumber: INPUT_FAKE_PHONE_NUMBER,
        password: INPUT_FAKE_PASSWORD,
      };

      const actualErrors = await validateCompleteAuth(inputPlain);

      const expectedError = actualErrors.find((error) => error.property === 'password');
      expect(expectedError).toBeDefined();
      expect(expectedError.constraints).toHaveProperty('passwordRequiresPhoneCode');
    });

    it('rejects a password sent with a blank phone code, which counts as absent', async () => {
      const inputPlain = {
        phoneNumber: INPUT_FAKE_PHONE_NUMBER,
        phoneCode: INPUT_BLANK_VALUE,
        password: INPUT_FAKE_PASSWORD,
      };

      const actualErrors = await validateCompleteAuth(inputPlain);

      const expectedError = actualErrors.find((error) => error.property === 'password');
      expect(expectedError).toBeDefined();
      expect(expectedError.constraints).toHaveProperty('passwordRequiresPhoneCode');
    });

    it('accepts a blank password without a phone code, because a blank password is absent', async () => {
      const inputPlain = {
        phoneNumber: INPUT_FAKE_PHONE_NUMBER,
        password: INPUT_BLANK_VALUE,
      };

      const actualDto = buildCompleteAuthDto(inputPlain);
      const actualErrors = await validateCompleteAuth(inputPlain);

      expect(actualDto.password).toBeUndefined();
      expect(actualErrors).toHaveLength(0);
    });

    it('accepts an empty-string password without a phone code', async () => {
      const inputPlain = { phoneNumber: INPUT_FAKE_PHONE_NUMBER, password: '' };

      const actualErrors = await validateCompleteAuth(inputPlain);

      expect(actualErrors).toHaveLength(0);
    });
  });

  describe('blank optional step fields', () => {
    it('accepts a caller that sends every field with an empty phone code and password', async () => {
      const inputPlain = { phoneNumber: INPUT_FAKE_PHONE_NUMBER, phoneCode: '', password: '' };

      const actualErrors = await validateCompleteAuth(inputPlain);

      expect(actualErrors).toHaveLength(0);
    });

    it('maps an empty phone code and password to undefined so step one still applies', async () => {
      const inputPlain = { phoneNumber: INPUT_FAKE_PHONE_NUMBER, phoneCode: '', password: '' };

      const actualDto = buildCompleteAuthDto(inputPlain);

      expect(actualDto.phoneCode).toBeUndefined();
      expect(actualDto.password).toBeUndefined();
      expect(actualDto.phoneNumber).toBe(INPUT_FAKE_PHONE_NUMBER);
    });

    it('keeps rejecting a non-empty invalid phone code', async () => {
      const inputPlain = {
        phoneNumber: INPUT_FAKE_PHONE_NUMBER,
        phoneCode: INPUT_INVALID_PHONE_CODE,
        password: '',
      };

      const actualErrors = await validateCompleteAuth(inputPlain);

      expect(actualErrors.map((error) => error.property)).toEqual(['phoneCode']);
    });

    it('keeps rejecting an empty phone number, which the mapping must not touch', async () => {
      const inputPlain = { phoneNumber: '', phoneCode: '', password: '' };

      const actualDto = buildCompleteAuthDto(inputPlain);
      const actualErrors = await validateCompleteAuth(inputPlain);

      expect(actualDto.phoneNumber).toBe('');
      expect(actualErrors.map((error) => error.property)).toContain('phoneNumber');
    });

    it('drops a whitespace-only phone code and password to undefined', async () => {
      const inputPlain = {
        phoneNumber: INPUT_FAKE_PHONE_NUMBER,
        phoneCode: INPUT_BLANK_VALUE,
        password: INPUT_BLANK_VALUE,
      };

      const actualDto = buildCompleteAuthDto(inputPlain);

      expect(actualDto.phoneCode).toBeUndefined();
      expect(actualDto.password).toBeUndefined();
    });

    it('accepts a request whose phone code and password are whitespace only', async () => {
      const inputPlain = {
        phoneNumber: INPUT_FAKE_PHONE_NUMBER,
        phoneCode: INPUT_BLANK_VALUE,
        password: INPUT_BLANK_VALUE,
      };

      const actualErrors = await validateCompleteAuth(inputPlain);

      expect(actualErrors).toHaveLength(0);
    });

    it('drops a whitespace-only password while a real phone code is kept', async () => {
      const inputPlain = {
        phoneNumber: INPUT_FAKE_PHONE_NUMBER,
        phoneCode: INPUT_FAKE_PHONE_CODE,
        password: INPUT_BLANK_VALUE,
      };

      const actualDto = buildCompleteAuthDto(inputPlain);
      const actualErrors = await validateCompleteAuth(inputPlain);

      expect(actualDto.phoneCode).toBe(INPUT_FAKE_PHONE_CODE);
      expect(actualDto.password).toBeUndefined();
      expect(actualErrors).toHaveLength(0);
    });

    it('preserves a password that has content around its spacing', async () => {
      const inputPlain = {
        phoneNumber: INPUT_FAKE_PHONE_NUMBER,
        phoneCode: INPUT_FAKE_PHONE_CODE,
        password: INPUT_PADDED_PASSWORD,
      };

      const actualDto = buildCompleteAuthDto(inputPlain);
      const actualErrors = await validateCompleteAuth(inputPlain);

      expect(actualDto.password).toBe(INPUT_PADDED_PASSWORD);
      expect(actualErrors).toHaveLength(0);
    });

    it('keeps rejecting a whitespace-only phone number, which the mapping must not touch', async () => {
      const inputPlain = { phoneNumber: INPUT_BLANK_VALUE };

      const actualDto = buildCompleteAuthDto(inputPlain);
      const actualErrors = await validateCompleteAuth(inputPlain);

      expect(actualDto.phoneNumber).toBe(INPUT_BLANK_VALUE);
      const expectedError = actualErrors.find((error) => error.property === 'phoneNumber');
      expect(expectedError).toBeDefined();
      expect(expectedError.constraints).toHaveProperty('matches');
    });
  });
});
