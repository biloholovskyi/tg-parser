import type { Request } from 'express';
import { SESSION_HEADER } from '../constants/http.constants';
import { readSessionHeader } from './session-header';

type InputHeaders = Record<string, string | string[]>;

const inputFakeSessionString = 'fake-session-string-one';
const inputOtherFakeSessionString = 'fake-session-string-two';
const inputPaddedSessionString = `  ${inputFakeSessionString}  `;
const inputWhitespaceOnlyValue = '   ';
const inputSessionStringWithSpace = 'fake session string==';

function createMockRequest(inputHeaders: InputHeaders): Request {
  return { headers: inputHeaders } as unknown as Request;
}

describe('readSessionHeader', () => {
  it('returns the single string value of the session header', () => {
    const actualSessionString = readSessionHeader(
      createMockRequest({ [SESSION_HEADER]: inputFakeSessionString }),
    );

    expect(actualSessionString).toBe(inputFakeSessionString);
  });

  it('trims surrounding whitespace from the header value', () => {
    const actualSessionString = readSessionHeader(
      createMockRequest({ [SESSION_HEADER]: inputPaddedSessionString }),
    );

    expect(actualSessionString).toBe(inputFakeSessionString);
  });

  it('keeps the inner characters of the value untouched', () => {
    const actualSessionString = readSessionHeader(
      createMockRequest({ [SESSION_HEADER]: inputSessionStringWithSpace }),
    );

    expect(actualSessionString).toBe(inputSessionStringWithSpace);
  });

  it('returns an empty string when the header is absent', () => {
    const actualSessionString = readSessionHeader(createMockRequest({}));

    expect(actualSessionString).toBe('');
  });

  it('returns an empty string for a repeated header delivered as an array', () => {
    const actualSessionString = readSessionHeader(
      createMockRequest({
        [SESSION_HEADER]: [inputFakeSessionString, inputOtherFakeSessionString],
      }),
    );

    expect(actualSessionString).toBe('');
  });

  it('returns an empty string for a whitespace-only value', () => {
    const actualSessionString = readSessionHeader(
      createMockRequest({ [SESSION_HEADER]: inputWhitespaceOnlyValue }),
    );

    expect(actualSessionString).toBe('');
  });

  it('returns an empty string for an empty header value', () => {
    const actualSessionString = readSessionHeader(createMockRequest({ [SESSION_HEADER]: '' }));

    expect(actualSessionString).toBe('');
  });

  it('reads the value from SESSION_HEADER and not from another header name', () => {
    const actualSessionString = readSessionHeader(
      createMockRequest({ 'x-other-header': inputFakeSessionString }),
    );

    expect(SESSION_HEADER).toBe('x-session-string');
    expect(actualSessionString).toBe('');
  });
});
