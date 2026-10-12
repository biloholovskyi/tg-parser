import type { Request } from 'express';
import { API_KEY_HEADER } from '../constants/http.constants';
import { readApiKeyHeader } from './api-key-header';

type InputHeaders = Record<string, string | string[]>;

const inputApiKey = 'fake-api-key-one';
const inputOtherApiKey = 'fake-api-key-two';

function createMockRequest(inputHeaders: InputHeaders): Request {
  return { headers: inputHeaders } as unknown as Request;
}

describe('readApiKeyHeader', () => {
  it('returns the single string value of the key header', () => {
    const actualApiKey = readApiKeyHeader(createMockRequest({ [API_KEY_HEADER]: inputApiKey }));

    expect(actualApiKey).toBe(inputApiKey);
  });

  it('returns an empty string when the header is absent', () => {
    const actualApiKey = readApiKeyHeader(createMockRequest({}));

    expect(actualApiKey).toBe('');
  });

  it('returns an empty string for a repeated header delivered as an array', () => {
    const actualApiKey = readApiKeyHeader(
      createMockRequest({ [API_KEY_HEADER]: [inputApiKey, inputOtherApiKey] }),
    );

    expect(actualApiKey).toBe('');
  });

  it('returns the empty header value unchanged', () => {
    const actualApiKey = readApiKeyHeader(createMockRequest({ [API_KEY_HEADER]: '' }));

    expect(actualApiKey).toBe('');
  });
});
