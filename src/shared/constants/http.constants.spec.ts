import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_PORT, REQUEST_BODY_MAX_BYTES } from './http.constants';

const RAILWAY_CONFIG_FILE = join(__dirname, '..', '..', '..', 'railway.toml');
const INTERNAL_PORT_PATTERN = /^\s*internal_port\s*=\s*(\d+)/m;

// The documented ceiling is 16 KiB; the concrete byte count is asserted so a change
// to the arithmetic in the source file cannot pass unnoticed.
const EXPECTED_REQUEST_BODY_MAX_BYTES = 16384;

function readConfiguredInternalPort(): number {
  const railwayConfig = readFileSync(RAILWAY_CONFIG_FILE, 'utf8');
  const matchedPort = INTERNAL_PORT_PATTERN.exec(railwayConfig);

  return matchedPort ? Number(matchedPort[1]) : Number.NaN;
}

describe('http constants', () => {
  it('keeps the default port equal to the port the platform routes traffic to', () => {
    const expectedPort = readConfiguredInternalPort();

    const actualPort = DEFAULT_PORT;

    expect(Number.isInteger(expectedPort)).toBe(true);
    expect(actualPort).toBe(expectedPort);
  });

  it('caps a request body at the documented number of bytes', () => {
    const actualMaxBytes = REQUEST_BODY_MAX_BYTES;

    expect(actualMaxBytes).toBe(EXPECTED_REQUEST_BODY_MAX_BYTES);
  });
});
