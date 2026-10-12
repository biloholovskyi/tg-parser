import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  RATE_LIMIT_DEFAULT_MAX_REQUESTS,
  RATE_LIMIT_DEFAULT_WINDOW_MS,
  RATE_LIMIT_STORE_MAX_ENTRIES,
} from '../constants/rate-limit.constants';
import { IS_PUBLIC_ROUTE_KEY } from '../decorators/public-route.decorator';
import { rejectWithRetryAfter } from '../utils/rate-limit-response';
import { RateLimitStore } from '../utils/rate-limit-store';
import { readApiKeyHeader } from '../utils/api-key-header';

/**
 * Caps how much work one caller key can order, on every route but the health probe.
 * Counters live in process memory with a ceiling; nothing about the caller is logged.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly store = new RateLimitStore({
    maxRequests: RATE_LIMIT_DEFAULT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_DEFAULT_WINDOW_MS,
    maxEntries: RATE_LIMIT_STORE_MAX_ENTRIES,
  });

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublicRoute = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublicRoute) {
      return true;
    }

    const httpContext = context.switchToHttp();
    const callerKey = readApiKeyHeader(httpContext.getRequest<Request>());
    const decision = this.store.consume(callerKey);

    if (!decision.isAllowed) {
      rejectWithRetryAfter(httpContext.getResponse<Response>(), decision.retryAfterMs);
    }

    return true;
  }
}
