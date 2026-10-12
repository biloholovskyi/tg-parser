import { Reflector } from '@nestjs/core';
import { IS_PHONE_RATE_LIMITED_KEY, PhoneRateLimited } from './phone-rate-limited.decorator';

class PhoneRateLimitedFixtureController {
  @PhoneRateLimited()
  authHandler(): void {}

  plainHandler(): void {}
}

describe('PhoneRateLimited', () => {
  const reflector = new Reflector();

  it('marks the decorated handler with the phone-rate-limit metadata key', () => {
    const actualMetadata = reflector.get<boolean>(
      IS_PHONE_RATE_LIMITED_KEY,
      PhoneRateLimitedFixtureController.prototype.authHandler,
    );

    expect(actualMetadata).toBe(true);
  });

  it('leaves an undecorated handler without the metadata', () => {
    const actualMetadata = reflector.get<boolean>(
      IS_PHONE_RATE_LIMITED_KEY,
      PhoneRateLimitedFixtureController.prototype.plainHandler,
    );

    expect(actualMetadata).toBeUndefined();
  });

  it('is resolved the way the guard reads it, through getAllAndOverride', () => {
    const actualMetadata = reflector.getAllAndOverride<boolean>(IS_PHONE_RATE_LIMITED_KEY, [
      PhoneRateLimitedFixtureController.prototype.authHandler,
      PhoneRateLimitedFixtureController,
    ]);

    expect(actualMetadata).toBe(true);
  });

  it('resolves to undefined for an undecorated handler on an undecorated class', () => {
    const actualMetadata = reflector.getAllAndOverride<boolean>(IS_PHONE_RATE_LIMITED_KEY, [
      PhoneRateLimitedFixtureController.prototype.plainHandler,
      PhoneRateLimitedFixtureController,
    ]);

    expect(actualMetadata).toBeUndefined();
  });
});
