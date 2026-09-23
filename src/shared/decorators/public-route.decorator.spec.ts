import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_ROUTE_KEY, PublicRoute } from './public-route.decorator';

class PublicRouteFixtureController {
  @PublicRoute()
  publicHandler(): void {}

  guardedHandler(): void {}
}

describe('PublicRoute', () => {
  const reflector = new Reflector();

  it('marks the decorated handler with the public-route metadata key', () => {
    const actualMetadata = reflector.get<boolean>(
      IS_PUBLIC_ROUTE_KEY,
      PublicRouteFixtureController.prototype.publicHandler,
    );

    expect(actualMetadata).toBe(true);
  });

  it('leaves an undecorated handler without the metadata', () => {
    const actualMetadata = reflector.get<boolean>(
      IS_PUBLIC_ROUTE_KEY,
      PublicRouteFixtureController.prototype.guardedHandler,
    );

    expect(actualMetadata).toBeUndefined();
  });

  it('is resolved the way the guard reads it, through getAllAndOverride', () => {
    const actualMetadata = reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      PublicRouteFixtureController.prototype.publicHandler,
      PublicRouteFixtureController,
    ]);

    expect(actualMetadata).toBe(true);
  });

  it('resolves to undefined for an undecorated handler on an undecorated class', () => {
    const actualMetadata = reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      PublicRouteFixtureController.prototype.guardedHandler,
      PublicRouteFixtureController,
    ]);

    expect(actualMetadata).toBeUndefined();
  });
});
