import type { Request } from 'express';
import { API_KEY_HEADER } from '../constants/http.constants';

/** A repeated header arrives as an array; only a single string value is a candidate key. */
export function readApiKeyHeader(request: Request): string {
  const headerValue = request.headers[API_KEY_HEADER];

  return typeof headerValue === 'string' ? headerValue : '';
}
