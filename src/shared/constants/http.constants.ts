const BYTES_IN_KILOBYTE = 1024;
const REQUEST_BODY_MAX_KILOBYTES = 16;

export const REQUEST_BODY_MAX_BYTES = REQUEST_BODY_MAX_KILOBYTES * BYTES_IN_KILOBYTE;

// Caller authentication header; see .claude/rules/api-security.md (AUTH_HEADER).
export const API_KEY_HEADER = 'x-api-key';

// Session transport header; a full account credential never travels in a URL.
export const SESSION_HEADER = 'x-session-string';

// Matches internal_port in railway.toml so local and deployed ports agree.
export const DEFAULT_PORT = 8080;
