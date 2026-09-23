import type { Request } from 'express';
import { SESSION_HEADER } from '../constants/http.constants';

/**
 * Reads the session credential from its header. A repeated header arrives as an array and
 * is treated as absent; the value is never logged, echoed, or placed in a URL.
 */
export function readSessionHeader(request: Request): string {
  const headerValue = request.headers[SESSION_HEADER];

  return typeof headerValue === 'string' ? headerValue.trim() : '';
}
