import { HttpException, HttpStatus } from '@nestjs/common';
import { MS_IN_SECOND } from '../constants/rate-limit.constants';

/** The same message for every limit: the caller learns when to retry, nothing else. */
export const TOO_MANY_REQUESTS_MESSAGE = 'Too many requests';
export const RETRY_AFTER_HEADER = 'Retry-After';

export function toRetryAfterSeconds(retryAfterMs: number): number {
  return Math.ceil(retryAfterMs / MS_IN_SECOND);
}

export class TooManyRequestsException extends HttpException {
  constructor(public readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: TOO_MANY_REQUESTS_MESSAGE,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
