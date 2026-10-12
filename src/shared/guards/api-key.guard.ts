import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { timingSafeEqual } from 'crypto';
import { getApiKeysConfig } from '../../config/api-keys.config';
import { IS_PUBLIC_ROUTE_KEY } from '../decorators/public-route.decorator';
import { readApiKeyHeader } from '../utils/api-key-header';

/** The same message for a missing, unknown or malformed key: the caller learns nothing. */
export const UNAUTHORIZED_MESSAGE = 'Unauthorized';

/**
 * Rejects every request that carries no known caller key.
 * The health probe opts out through PublicRoute, not through a path comparison.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublicRoute = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublicRoute) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const presentedKey = readApiKeyHeader(request);
    const { apiKeys } = getApiKeysConfig();

    if (!presentedKey || !isKnownApiKey(presentedKey, apiKeys)) {
      throw new UnauthorizedException(UNAUTHORIZED_MESSAGE);
    }

    return true;
  }
}

/** Compares against every configured key without an early exit, so timing leaks no prefix. */
function isKnownApiKey(presentedKey: string, apiKeys: string[]): boolean {
  return apiKeys.reduce(
    (isKnown, apiKey) => equalsInConstantTime(presentedKey, apiKey) || isKnown,
    false,
  );
}

function equalsInConstantTime(presentedKey: string, apiKey: string): boolean {
  const presentedBytes = Buffer.from(presentedKey);
  const expectedBytes = Buffer.from(apiKey);

  if (presentedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(presentedBytes, expectedBytes);
}
