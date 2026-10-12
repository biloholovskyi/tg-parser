import type { Response } from 'express';
import {
  RETRY_AFTER_HEADER,
  TooManyRequestsException,
  toRetryAfterSeconds,
} from '../exceptions/too-many-requests.exception';

/** Always throws: the caller is told how long to wait, both in the header and in the body. */
export function rejectWithRetryAfter(response: Response, retryAfterMs: number): never {
  const retryAfterSeconds = toRetryAfterSeconds(retryAfterMs);
  response.setHeader(RETRY_AFTER_HEADER, retryAfterSeconds);

  throw new TooManyRequestsException(retryAfterSeconds);
}
