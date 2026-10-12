import type { Request } from 'express';
import { SESSION_HEADER } from '../constants/http.constants';

/** The 400 message for a route that needs a session but received none. */
export const MISSING_SESSION_MESSAGE = `A session string is required in the ${SESSION_HEADER} header`;

/**
 * Reads the session credential from its header. A repeated header arrives as an array and
 * is treated as absent; the value is never logged, echoed, or placed in a URL.
 */
export function readSessionHeader(request: Request): string {
  const headerValue = request.headers[SESSION_HEADER];

  return typeof headerValue === 'string' ? headerValue.trim() : '';
}
