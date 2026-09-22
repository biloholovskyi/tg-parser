const BYTES_IN_KILOBYTE = 1024;
const REQUEST_BODY_MAX_KILOBYTES = 16;

export const REQUEST_BODY_MAX_BYTES = REQUEST_BODY_MAX_KILOBYTES * BYTES_IN_KILOBYTE;

// Matches internal_port in railway.toml so local and deployed ports agree.
export const DEFAULT_PORT = 8080;
