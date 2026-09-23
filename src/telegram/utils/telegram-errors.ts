import {
  BadGatewayException,
  BadRequestException,
  HttpException,
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

export const MISSING_CONFIG_MESSAGE = 'Telegram API credentials are not configured';
export const INVALID_SESSION_MESSAGE = 'Session is invalid or revoked, authenticate again';
export const CHANNEL_UNAVAILABLE_MESSAGE = 'Channel not found or not accessible to this account';
export const TELEGRAM_UNAVAILABLE_MESSAGE = 'Telegram is unreachable, retry later';
export const TELEGRAM_FAILED_MESSAGE = 'Telegram request failed';

const FLOOD_WAIT_CODE_PATTERN = /^FLOOD(?:_PREMIUM)?_WAIT_(\d+)$/;

/**
 * The exact MTProto error code of an RPC error, or undefined for any other failure.
 * Classification uses this code only, never a substring of the message: GramJS echoes
 * caller input (a channel username) into some messages, which must not steer the mapping.
 */
function rpcCodeOf(error: unknown): string | undefined {
  const code = (error as { errorMessage?: unknown } | null)?.errorMessage;
  return typeof code === 'string' && code ? code : undefined;
}

/** Message of a non-RPC error (raised by GramJS client code or by this service). */
function localMessageOf(error: unknown): string | undefined {
  return rpcCodeOf(error) === undefined && error instanceof Error ? error.message : undefined;
}

function isOneOf(code: string | undefined, codes: readonly string[]): boolean {
  return code !== undefined && codes.includes(code);
}

/**
 * A short, log-safe description: the MTProto error code when there is one, otherwise the
 * error class and message. Never includes request arguments such as a phone or session.
 */
export function describeError(error: unknown): string {
  const code = rpcCodeOf(error);
  if (code) {
    return code;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/** True when Telegram rejected the session itself, so a cached client for it is useless. */
export function isInvalidSessionError(error: unknown): boolean {
  return (
    error instanceof UnauthorizedException || isOneOf(rpcCodeOf(error), INVALID_SESSION_ERRORS)
  );
}

/** Seconds Telegram asked us to wait, or undefined when the error is not a flood wait. */
export function floodWaitSeconds(error: unknown): number | undefined {
  const seconds = (error as { seconds?: unknown } | null)?.seconds;
  if (typeof seconds === 'number') {
    return seconds;
  }
  const code = rpcCodeOf(error);
  if (isOneOf(code, PHONE_FLOOD_ERRORS)) {
    return PHONE_FLOOD_RETRY_AFTER_S;
  }
  const match = code === undefined ? null : FLOOD_WAIT_CODE_PATTERN.exec(code);
  return match ? Number(match[1]) : undefined;
}

/** True when the failure is the transport, not a verdict about the session or the input. */
export function isConnectivityError(error: unknown): boolean {
  if (rpcCodeOf(error) === RPC_TIMEOUT_CODE) {
    return true;
  }
  const message = localMessageOf(error);
  return (
    message !== undefined &&
    (message.endsWith(TIMEOUT_SUFFIX) || CONNECTIVITY_ERRORS.some((sign) => message.includes(sign)))
  );
}

/** True when the channel does not exist or this account cannot read it. */
export function isChannelUnavailableError(error: unknown): boolean {
  const message = localMessageOf(error);
  return (
    isOneOf(rpcCodeOf(error), CHANNEL_UNAVAILABLE_ERRORS) ||
    (message !== undefined &&
      CHANNEL_LOOKUP_FAILURE_PREFIXES.some((prefix) => message.startsWith(prefix)))
  );
}

/** Caller-facing message for a wrong auth input, or undefined when the error is not one. */
function authInputMessage(error: unknown): string | undefined {
  const code = rpcCodeOf(error);
  return AUTH_INPUT_ERRORS.find(([authCode]) => authCode === code)?.[1];
}

/**
 * Maps any failure of a Telegram call to an HTTP exception with a fixed, caller-safe message.
 * The original error is kept as `cause`; its MTProto text and stack never reach the response.
 */
export function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }
  const waitSeconds = floodWaitSeconds(error);
  if (waitSeconds !== undefined) {
    return new TooManyRequestsException(waitSeconds, error);
  }
  if (isInvalidSessionError(error)) {
    return invalidSessionException(error);
  }
  if (isChannelUnavailableError(error)) {
    return new NotFoundException(CHANNEL_UNAVAILABLE_MESSAGE, { cause: error });
  }
  const authMessage = authInputMessage(error);
  if (authMessage) {
    return new BadRequestException(authMessage, { cause: error });
  }
  if (isConnectivityError(error)) {
    return new ServiceUnavailableException(TELEGRAM_UNAVAILABLE_MESSAGE, { cause: error });
  }
  return new BadGatewayException(TELEGRAM_FAILED_MESSAGE, { cause: error });
}

/**
 * The single 401 for an unknown or a revoked session: identical body in both cases, so the API
 * does not reveal which sessions this process knows.
 */
export function invalidSessionException(cause?: unknown): UnauthorizedException {
  return new UnauthorizedException(INVALID_SESSION_MESSAGE, { cause });
}

/** Raised at use time when the API credentials are absent; boot stays healthy without them. */
export function missingConfigException(): InternalServerErrorException {
  return new InternalServerErrorException(MISSING_CONFIG_MESSAGE);
}
