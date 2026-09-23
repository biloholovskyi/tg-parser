import 'reflect-metadata';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { SESSION_HEADER } from '../constants/http.constants';
import { readSessionHeader } from '../utils/session-header';
import { SessionString } from './session-string.decorator';

type InputHeaders = Record<string, string | string[]>;
type ParamDecoratorFactory = (data: unknown, context: ExecutionContext) => string;
type RouteArgMetadata = { factory: ParamDecoratorFactory };

const inputFakeSessionString = 'fake-session-string-one';
const inputOtherFakeSessionString = 'fake-session-string-two';
const inputPaddedSessionString = `  ${inputFakeSessionString}  `;
const inputSessionStringWithSpace = 'fake session string==';

/** Fixture whose only job is to carry the decorator so its factory becomes reachable. */
class SessionStringFixtureController {
  handler(@SessionString() sessionString: string): string {
    return sessionString;
  }
}

/**
 * `createParamDecorator` hides the factory, but stores it in the route-argument metadata
 * that NestJS itself reads when it resolves a handler parameter.
 */
function readSessionStringFactory(): ParamDecoratorFactory {
  const routeArgs = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    SessionStringFixtureController,
    'handler',
  ) as Record<string, RouteArgMetadata>;

  return Object.values(routeArgs)[0].factory;
}

function createMockContext(inputHeaders: InputHeaders): ExecutionContext {
  const mockRequest = { headers: inputHeaders } as unknown as Request;

  return {
    switchToHttp: () => ({ getRequest: () => mockRequest }),
  } as unknown as ExecutionContext;
}

describe('SessionString', () => {
  it('registers a route-argument factory on the decorated parameter', () => {
    const actualFactory = readSessionStringFactory();

    expect(typeof actualFactory).toBe('function');
  });

  it('returns the session header value taken from the http request', () => {
    const actualFactory = readSessionStringFactory();

    const actualSessionString = actualFactory(
      undefined,
      createMockContext({ [SESSION_HEADER]: inputFakeSessionString }),
    );

    expect(actualSessionString).toBe(inputFakeSessionString);
  });

  it('returns an empty string when the session header is absent', () => {
    const actualFactory = readSessionStringFactory();

    const actualSessionString = actualFactory(undefined, createMockContext({}));

    expect(actualSessionString).toBe('');
  });

  it('returns exactly what readSessionHeader returns for the same headers', () => {
    const actualFactory = readSessionStringFactory();
    const inputHeaderCases: InputHeaders[] = [
      { [SESSION_HEADER]: inputFakeSessionString },
      { [SESSION_HEADER]: inputPaddedSessionString },
      { [SESSION_HEADER]: inputSessionStringWithSpace },
      { [SESSION_HEADER]: [inputFakeSessionString, inputOtherFakeSessionString] },
      {},
    ];

    for (const inputHeaders of inputHeaderCases) {
      const expectedSessionString = readSessionHeader({
        headers: inputHeaders,
      } as unknown as Request);

      expect(actualFactory(undefined, createMockContext(inputHeaders))).toBe(expectedSessionString);
    }
  });

  it('reads the request through switchToHttp rather than another context kind', () => {
    const actualFactory = readSessionStringFactory();
    const mockGetRequest = jest.fn(() => ({ headers: {} }) as unknown as Request);
    const mockContext = {
      switchToHttp: () => ({ getRequest: mockGetRequest }),
    } as unknown as ExecutionContext;

    actualFactory(undefined, mockContext);

    expect(mockGetRequest).toHaveBeenCalledTimes(1);
  });
});
