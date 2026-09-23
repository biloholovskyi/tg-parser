import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { TooManyRequestsException } from '../../shared/exceptions/too-many-requests.exception';
import {
  AUTH_INPUT_ERRORS,
  CHANNEL_LOOKUP_FAILURE_PREFIXES,
  CHANNEL_UNAVAILABLE_ERRORS,
  CONNECTIVITY_ERRORS,
  INVALID_SESSION_ERRORS,
  PHONE_FLOOD_ERRORS,
  PHONE_FLOOD_RETRY_AFTER_S,
  RPC_TIMEOUT_CODE,
  TIMEOUT_SUFFIX,
} from '../constants';
import {
  CHANNEL_UNAVAILABLE_MESSAGE,
  INVALID_SESSION_MESSAGE,
  MISSING_CONFIG_MESSAGE,
  TELEGRAM_FAILED_MESSAGE,
  TELEGRAM_UNAVAILABLE_MESSAGE,
  describeError,
  floodWaitSeconds,
  isChannelUnavailableError,
  isConnectivityError,
  isInvalidSessionError,
  missingConfigException,
  toHttpException,
} from './telegram-errors';

const INPUT_FLOOD_SECONDS = 42;
const INPUT_PREMIUM_FLOOD_SECONDS = 17;
const INPUT_UNKNOWN_RPC_MESSAGE =
  'RPCError: 500: FAKE_INTERNAL_UNKNOWN_ERROR (caused by fake.Call)';

/** A fake GramJS RPCError: the exact MTProto code travels in `errorMessage`. */
function rpcError(code: string): Error {
  return Object.assign(new Error(`RPCError: 400: ${code} (caused by fake.Call)`), {
    errorMessage: code,
  });
}

function responseText(exception: { getResponse(): unknown }): string {
  return JSON.stringify(exception.getResponse());
}

describe('isInvalidSessionError', () => {
  it.each(INVALID_SESSION_ERRORS)('returns true for an Error carrying %s', (inputCode) => {
    // Arrange
    const inputError = rpcError(inputCode);

    // Act
    const actualResult = isInvalidSessionError(inputError);

    // Assert
    expect(actualResult).toBe(true);
  });

  it.each(INVALID_SESSION_ERRORS)(
    'returns false for a plain Error whose message merely contains %s',
    (inputCode) => {
      // Arrange
      const inputError = new Error(`RPCError: 401: ${inputCode} (caused by users.GetUsers)`);

      // Act
      const actualResult = isInvalidSessionError(inputError);

      // Assert
      expect(actualResult).toBe(false);
    },
  );

  it('returns false when the RPC code only contains a session code as a substring', () => {
    // Act
    const actualResult = isInvalidSessionError(rpcError('FAKE_AUTH_KEY_UNREGISTERED_SUFFIX'));

    // Assert
    expect(actualResult).toBe(false);
  });

  it.each(['FLOOD_WAIT_30', 'CHANNEL_PRIVATE', 'USERNAME_INVALID', 'Connection timeout'])(
    'returns false for an unrelated error %s',
    (inputMessage) => {
      // Arrange
      const inputError = new Error(inputMessage);

      // Act
      const actualResult = isInvalidSessionError(inputError);

      // Assert
      expect(actualResult).toBe(false);
    },
  );

  it.each([undefined, null, 0, {}, 'plain text'])(
    'returns false for non-Error input %p',
    (inputValue) => {
      // Act
      const actualResult = isInvalidSessionError(inputValue);

      // Assert
      expect(actualResult).toBe(false);
    },
  );

  it('does not treat a code thrown as a bare string as an invalid session', () => {
    // Act
    const actualResult = isInvalidSessionError('AUTH_KEY_UNREGISTERED');

    // Assert
    expect(actualResult).toBe(false);
  });

  it('returns true for an UnauthorizedException (unknown session)', () => {
    // Act
    const actualResult = isInvalidSessionError(new UnauthorizedException('fake'));

    // Assert
    expect(actualResult).toBe(true);
  });
});

describe('floodWaitSeconds', () => {
  it('reads a numeric seconds property', () => {
    // Arrange
    const inputError = Object.assign(new Error('fake flood'), { seconds: INPUT_FLOOD_SECONDS });

    // Act
    const actualResult = floodWaitSeconds(inputError);

    // Assert
    expect(actualResult).toBe(INPUT_FLOOD_SECONDS);
  });

  it('parses FLOOD_WAIT_N and FLOOD_PREMIUM_WAIT_N from the RPC code', () => {
    // Act
    const actualPlain = floodWaitSeconds(rpcError(`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`));
    const actualPremium = floodWaitSeconds(
      rpcError(`FLOOD_PREMIUM_WAIT_${INPUT_PREMIUM_FLOOD_SECONDS}`),
    );

    // Assert
    expect(actualPlain).toBe(INPUT_FLOOD_SECONDS);
    expect(actualPremium).toBe(INPUT_PREMIUM_FLOOD_SECONDS);
  });

  it.each(PHONE_FLOOD_ERRORS)('returns PHONE_FLOOD_RETRY_AFTER_S for %s', (inputCode) => {
    // Act
    const actualResult = floodWaitSeconds(rpcError(inputCode));

    // Assert
    expect(actualResult).toBe(PHONE_FLOOD_RETRY_AFTER_S);
  });

  it.each([
    [
      'a plain Error carrying the code in its message',
      new Error(`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`),
    ],
    ['a bare string', `FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`],
    ['an RPC code with a trailing suffix', rpcError(`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}_FAKE`)],
    ['an RPC code with a leading prefix', rpcError(`FAKE_FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`)],
    ['a plain Error mentioning PHONE_NUMBER_FLOOD', new Error('fake PHONE_NUMBER_FLOOD text')],
  ])('returns undefined for %s', (_label, inputValue) => {
    // Act
    const actualResult = floodWaitSeconds(inputValue);

    // Assert
    expect(actualResult).toBeUndefined();
  });

  it.each([new Error('CHANNEL_PRIVATE'), null, undefined, 'plain text'])(
    'returns undefined for a non-flood input %p',
    (inputValue) => {
      // Act
      const actualResult = floodWaitSeconds(inputValue);

      // Assert
      expect(actualResult).toBeUndefined();
    },
  );
});

describe('isConnectivityError', () => {
  it.each(CONNECTIVITY_ERRORS)('returns true for a message carrying %s', (inputCode) => {
    // Act
    const actualResult = isConnectivityError(new Error(`fake ${inputCode} failure`));

    // Assert
    expect(actualResult).toBe(true);
  });

  it('returns false for a Telegram verdict', () => {
    // Act
    const actualResult = isConnectivityError(rpcError('CHANNEL_PRIVATE'));

    // Assert
    expect(actualResult).toBe(false);
  });

  it('returns true for the RPC TIMEOUT code', () => {
    // Act
    const actualResult = isConnectivityError(rpcError(RPC_TIMEOUT_CODE));

    // Assert
    expect(actualResult).toBe(true);
  });

  it('returns true for a plain Error ending with TIMEOUT_SUFFIX', () => {
    // Act
    const actualResult = isConnectivityError(new Error(`Fake call${TIMEOUT_SUFFIX}`));

    // Assert
    expect(actualResult).toBe(true);
  });

  it('returns false for a plain Error that mentions timeout but does not end with it', () => {
    // Act
    const actualResult = isConnectivityError(new Error(`Fake call${TIMEOUT_SUFFIX} and more`));

    // Assert
    expect(actualResult).toBe(false);
  });

  it.each(CONNECTIVITY_ERRORS)(
    'returns false for an RPC error whose code text mentions %s',
    (inputSign) => {
      // Act
      const actualResult = isConnectivityError(rpcError(`FAKE_${inputSign}`));

      // Assert
      expect(actualResult).toBe(false);
    },
  );

  it.each([undefined, null, 'ECONNRESET'])('returns false for non-Error input %p', (inputValue) => {
    // Act
    const actualResult = isConnectivityError(inputValue);

    // Assert
    expect(actualResult).toBe(false);
  });
});

describe('isChannelUnavailableError', () => {
  it.each(CHANNEL_UNAVAILABLE_ERRORS)('returns true for the RPC code %s', (inputCode) => {
    // Act
    const actualResult = isChannelUnavailableError(rpcError(inputCode));

    // Assert
    expect(actualResult).toBe(true);
  });

  it.each(CHANNEL_LOOKUP_FAILURE_PREFIXES)(
    'returns true for a plain Error starting with "%s"',
    (inputPrefix) => {
      // Act
      const actualResult = isChannelUnavailableError(new Error(`${inputPrefix} "fake_channel"`));

      // Assert
      expect(actualResult).toBe(true);
    },
  );

  it.each(CHANNEL_LOOKUP_FAILURE_PREFIXES)(
    'returns false when "%s" appears later in the message',
    (inputPrefix) => {
      // Act
      const actualResult = isChannelUnavailableError(new Error(`fake: ${inputPrefix} x`));

      // Assert
      expect(actualResult).toBe(false);
    },
  );

  it.each(CHANNEL_UNAVAILABLE_ERRORS)(
    'returns false for a plain Error whose message merely contains %s',
    (inputCode) => {
      // Act
      const actualResult = isChannelUnavailableError(new Error(`${inputCode} fake detail`));

      // Assert
      expect(actualResult).toBe(false);
    },
  );

  it('returns false for a bare string starting with a lookup prefix', () => {
    // Act
    const actualResult = isChannelUnavailableError(`${CHANNEL_LOOKUP_FAILURE_PREFIXES[0]} x`);

    // Assert
    expect(actualResult).toBe(false);
  });
});

describe('toHttpException', () => {
  it('passes an HttpException through unchanged', () => {
    // Arrange
    const inputException = new ForbiddenException('fake forbidden');

    // Act
    const actualResult = toHttpException(inputException);

    // Assert
    expect(actualResult).toBe(inputException);
  });

  it('maps a flood wait carried in `seconds` to 429 with retryAfterSeconds', () => {
    // Arrange
    const inputError = Object.assign(new Error('A wait of 42 seconds is required'), {
      seconds: INPUT_FLOOD_SECONDS,
    });

    // Act
    const actualResult = toHttpException(inputError);

    // Assert
    expect(actualResult).toBeInstanceOf(TooManyRequestsException);
    expect(actualResult.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(actualResult.getResponse()).toEqual(
      expect.objectContaining({ retryAfterSeconds: INPUT_FLOOD_SECONDS }),
    );
  });

  it('maps FLOOD_WAIT_N in the message to 429 with retryAfterSeconds', () => {
    // Act
    const actualResult = toHttpException(rpcError(`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`));

    // Assert
    expect(actualResult.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(actualResult.getResponse()).toEqual(
      expect.objectContaining({ retryAfterSeconds: INPUT_FLOOD_SECONDS }),
    );
  });

  it('maps FLOOD_PREMIUM_WAIT_N in the message to 429 with retryAfterSeconds', () => {
    // Act
    const actualResult = toHttpException(
      rpcError(`FLOOD_PREMIUM_WAIT_${INPUT_PREMIUM_FLOOD_SECONDS}`),
    );

    // Assert
    expect(actualResult.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(actualResult.getResponse()).toEqual(
      expect.objectContaining({ retryAfterSeconds: INPUT_PREMIUM_FLOOD_SECONDS }),
    );
  });

  it.each(INVALID_SESSION_ERRORS)('maps %s to 401 with the fixed session message', (inputCode) => {
    // Act
    const actualResult = toHttpException(rpcError(inputCode));

    // Assert
    expect(actualResult).toBeInstanceOf(UnauthorizedException);
    expect(actualResult.message).toBe(INVALID_SESSION_MESSAGE);
  });

  it.each(CHANNEL_UNAVAILABLE_ERRORS)('maps "%s" to 404', (inputCode) => {
    // Act
    const actualResult = toHttpException(rpcError(inputCode));

    // Assert
    expect(actualResult).toBeInstanceOf(NotFoundException);
    expect(actualResult.message).toBe(CHANNEL_UNAVAILABLE_MESSAGE);
  });

  it.each(AUTH_INPUT_ERRORS)('maps %s to 400 with message "%s"', (inputCode, expectedMessage) => {
    // Act
    const actualResult = toHttpException(rpcError(inputCode));

    // Assert
    expect(actualResult).toBeInstanceOf(BadRequestException);
    expect(actualResult.message).toBe(expectedMessage);
  });

  it('gives every code and password error a distinct message', () => {
    // Arrange
    const inputCodes = [
      'PHONE_CODE_EXPIRED',
      'PHONE_CODE_INVALID',
      'PHONE_CODE_EMPTY',
      'PASSWORD_HASH_INVALID',
    ];

    // Act
    const actualMessages = inputCodes.map((code) => toHttpException(rpcError(code)).message);

    // Assert
    expect(new Set(actualMessages).size).toBe(inputCodes.length);
  });

  it('gives PHONE_NUMBER_INVALID and PHONE_NUMBER_BANNED the same message on purpose', () => {
    // Act
    const actualInvalid = toHttpException(rpcError('PHONE_NUMBER_INVALID'));
    const actualBanned = toHttpException(rpcError('PHONE_NUMBER_BANNED'));

    // Assert
    expect(actualInvalid).toBeInstanceOf(BadRequestException);
    expect(actualBanned).toBeInstanceOf(BadRequestException);
    expect(actualBanned.message).toBe(actualInvalid.message);
  });

  it('keeps the phone-number message distinct from every code and password message', () => {
    // Arrange
    const inputOtherCodes = [
      'PHONE_CODE_EXPIRED',
      'PHONE_CODE_INVALID',
      'PHONE_CODE_EMPTY',
      'PASSWORD_HASH_INVALID',
    ];

    // Act
    const actualPhoneMessage = toHttpException(rpcError('PHONE_NUMBER_INVALID')).message;
    const actualOtherMessages = inputOtherCodes.map(
      (code) => toHttpException(rpcError(code)).message,
    );

    // Assert
    expect(actualOtherMessages).not.toContain(actualPhoneMessage);
  });

  it.each(PHONE_FLOOD_ERRORS)(
    'maps %s to 429 with PHONE_FLOOD_RETRY_AFTER_S instead of 400 or 502',
    (inputCode) => {
      // Act
      const actualResult = toHttpException(rpcError(inputCode));

      // Assert
      expect(actualResult).toBeInstanceOf(TooManyRequestsException);
      expect(actualResult.getResponse()).toEqual(
        expect.objectContaining({ retryAfterSeconds: PHONE_FLOOD_RETRY_AFTER_S }),
      );
    },
  );

  it('maps the RPC TIMEOUT code to 503', () => {
    // Act
    const actualResult = toHttpException(rpcError(RPC_TIMEOUT_CODE));

    // Assert
    expect(actualResult).toBeInstanceOf(ServiceUnavailableException);
    expect(actualResult.message).toBe(TELEGRAM_UNAVAILABLE_MESSAGE);
  });

  it.each(CHANNEL_LOOKUP_FAILURE_PREFIXES)(
    'maps a local lookup failure starting with "%s" to 404',
    (inputPrefix) => {
      // Act
      const actualResult = toHttpException(new Error(`${inputPrefix} "fake_channel"`));

      // Assert
      expect(actualResult).toBeInstanceOf(NotFoundException);
      expect(actualResult.message).toBe(CHANNEL_UNAVAILABLE_MESSAGE);
    },
  );

  it.each(CONNECTIVITY_ERRORS)('maps a transport failure carrying %s to 503', (inputCode) => {
    // Act
    const actualResult = toHttpException(new Error(`fake ${inputCode} failure`));

    // Assert
    expect(actualResult).toBeInstanceOf(ServiceUnavailableException);
    expect(actualResult.message).toBe(TELEGRAM_UNAVAILABLE_MESSAGE);
  });

  it('maps the withTimeout expiry error to 503', () => {
    // Act
    const actualResult = toHttpException(new Error('Get messages timeout'));

    // Assert
    expect(actualResult.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it.each([new Error(INPUT_UNKNOWN_RPC_MESSAGE), 'bare string', undefined, null, {}])(
    'maps an unrecognised failure %p to 502',
    (inputValue) => {
      // Act
      const actualResult = toHttpException(inputValue);

      // Assert
      expect(actualResult).toBeInstanceOf(BadGatewayException);
      expect(actualResult.message).toBe(TELEGRAM_FAILED_MESSAGE);
    },
  );

  it.each([
    [`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`],
    ['SESSION_REVOKED'],
    ['CHANNEL_PRIVATE'],
    ['PHONE_CODE_INVALID'],
    ['ECONNRESET'],
    ['FAKE_INTERNAL_UNKNOWN_ERROR'],
  ])('keeps the original error as cause for %s', (inputCode) => {
    // Arrange
    const inputError = rpcError(inputCode);

    // Act
    const actualResult = toHttpException(inputError);

    // Assert
    expect(actualResult.cause).toBe(inputError);
  });

  it.each([
    ['SESSION_REVOKED'],
    ['CHANNEL_PRIVATE'],
    ['PHONE_CODE_INVALID'],
    ['ECONNRESET'],
    [`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`],
    ['FAKE_INTERNAL_UNKNOWN_ERROR'],
  ])('never puts the raw MTProto text for %s in the response body', (inputCode) => {
    // Arrange
    const inputError = rpcError(inputCode);

    // Act
    const actualBody = responseText(toHttpException(inputError));

    // Assert
    expect(actualBody).not.toContain('RPCError');
    expect(actualBody).not.toContain('caused by');
    expect(actualBody).not.toContain(inputCode);
  });

  it('checks flood wait before the session codes when both apply', () => {
    // Arrange
    const inputError = Object.assign(rpcError('SESSION_REVOKED'), {
      seconds: INPUT_FLOOD_SECONDS,
    });

    // Act
    const actualResult = toHttpException(inputError);

    // Assert
    expect(actualResult.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('maps an RPC code that is not an exact flood code to 502', () => {
    // Act
    const actualResult = toHttpException(
      rpcError(`FLOOD_WAIT_${INPUT_FLOOD_SECONDS} SESSION_REVOKED`),
    );

    // Assert
    expect(actualResult).toBeInstanceOf(BadGatewayException);
  });

  describe('caller input echoed into a GramJS message never steers the mapping (M1)', () => {
    const lookupPrefix = CHANNEL_LOOKUP_FAILURE_PREFIXES[0];

    it.each([
      ['AUTH_KEY_UNREGISTERED'],
      ['SESSION_REVOKED'],
      [`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`],
      ['PHONE_NUMBER_FLOOD'],
      ['ECONNRESET'],
      ['PHONE_CODE_INVALID'],
      [`fake${TIMEOUT_SUFFIX}`],
    ])('maps `No user has "%s" as username` to 404', (inputUsername) => {
      // Arrange
      const inputError = new Error(`${lookupPrefix} "${inputUsername}" as username`);

      // Act
      const actualResult = toHttpException(inputError);

      // Assert
      expect(actualResult).toBeInstanceOf(NotFoundException);
      expect(actualResult.message).toBe(CHANNEL_UNAVAILABLE_MESSAGE);
    });

    it('does not classify the echoed session code as an invalid session', () => {
      // Arrange
      const inputError = new Error(`${lookupPrefix} "AUTH_KEY_UNREGISTERED" as username`);

      // Act
      const actualResult = isInvalidSessionError(inputError);

      // Assert
      expect(actualResult).toBe(false);
    });

    it('does not read a flood wait from the echoed text', () => {
      // Arrange
      const inputError = new Error(`${lookupPrefix} "FLOOD_WAIT_99999" as username`);

      // Act
      const actualResult = floodWaitSeconds(inputError);

      // Assert
      expect(actualResult).toBeUndefined();
    });
  });
});

describe('missingConfigException', () => {
  it('is a 500 with the missing-config message', () => {
    // Act
    const actualResult = missingConfigException();

    // Assert
    expect(actualResult).toBeInstanceOf(InternalServerErrorException);
    expect(actualResult.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(actualResult.message).toBe(MISSING_CONFIG_MESSAGE);
  });
});

describe('describeError', () => {
  it('returns the MTProto errorMessage when the error carries one', () => {
    // Arrange
    const inputError = Object.assign(new Error('RPCError: 400: PHONE_CODE_INVALID (caused by x)'), {
      errorMessage: 'PHONE_CODE_INVALID',
    });

    // Act
    const actualResult = describeError(inputError);

    // Assert
    expect(actualResult).toBe('PHONE_CODE_INVALID');
  });

  it('falls back to "name: message" for a plain Error', () => {
    // Arrange
    const inputError = new TypeError('fake type failure');

    // Act
    const actualResult = describeError(inputError);

    // Assert
    expect(actualResult).toBe('TypeError: fake type failure');
  });

  it('falls back to "name: message" when errorMessage is an empty string', () => {
    // Arrange
    const inputError = Object.assign(new Error('fake failure'), { errorMessage: '' });

    // Act
    const actualResult = describeError(inputError);

    // Assert
    expect(actualResult).toBe('Error: fake failure');
  });

  it('falls back to "name: message" when errorMessage is not a string', () => {
    // Arrange
    const inputError = Object.assign(new Error('fake failure'), {
      errorMessage: INPUT_FLOOD_SECONDS,
    });

    // Act
    const actualResult = describeError(inputError);

    // Assert
    expect(actualResult).toBe('Error: fake failure');
  });

  it('returns errorMessage from a non-Error object that carries one', () => {
    // Act
    const actualResult = describeError({ errorMessage: `FLOOD_WAIT_${INPUT_FLOOD_SECONDS}` });

    // Assert
    expect(actualResult).toBe(`FLOOD_WAIT_${INPUT_FLOOD_SECONDS}`);
  });

  it.each([
    ['a string', 'fake raw failure', 'fake raw failure'],
    ['a number', INPUT_FLOOD_SECONDS, String(INPUT_FLOOD_SECONDS)],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
  ])('stringifies non-Error input: %s', (_label, inputError, expectedResult) => {
    // Act
    const actualResult = describeError(inputError);

    // Assert
    expect(actualResult).toBe(expectedResult);
  });
});
