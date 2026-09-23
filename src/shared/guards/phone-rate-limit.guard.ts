import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  RATE_LIMIT_AUTH_MAX_REQUESTS,
  RATE_LIMIT_AUTH_WINDOW_MS,
  RATE_LIMIT_STORE_MAX_ENTRIES,
} from '../constants/rate-limit.constants';
import { IS_PHONE_RATE_LIMITED_KEY } from '../decorators/phone-rate-limited.decorator';
import { rejectWithRetryAfter } from '../utils/rate-limit-response';
import { RateLimitStore } from '../utils/rate-limit-store';

/**
 * Counts the auth route per phone number, independently of the caller key, because the
 * SMS is charged to the Telegram application. Only the digest of a number is stored.
 */
@Injectable()
export class PhoneRateLimitGuard implements CanActivate {
  private readonly store = new RateLimitStore({
    maxRequests: RATE_LIMIT_AUTH_MAX_REQUESTS,
    windowMs: RATE_LIMIT_AUTH_WINDOW_MS,
    maxEntries: RATE_LIMIT_STORE_MAX_ENTRIES,
  });

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPhoneRateLimited = this.reflector.getAllAndOverride<boolean>(
      IS_PHONE_RATE_LIMITED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isPhoneRateLimited) {
      return true;
    }

    const httpContext = context.switchToHttp();
    const phoneNumber = readPhoneNumber(httpContext.getRequest<Request>());
    if (!phoneNumber) {
      return true;
    }

    const decision = this.store.consume(phoneNumber);
    if (!decision.isAllowed) {
      rejectWithRetryAfter(httpContext.getResponse<Response>(), decision.retryAfterMs);
    }

    return true;
  }
}

const NON_DIGIT_PATTERN = /\D/g;

/**
 * A request without a usable number is left to DTO validation, which rejects it.
 * The number is reduced to its digits so that "+7..." and "7..." share one counter.
 */
function readPhoneNumber(request: Request): string {
  const requestBody: unknown = request.body;
  if (!requestBody || typeof requestBody !== 'object') {
    return '';
  }

  const phoneNumber = (requestBody as Record<string, unknown>).phoneNumber;

  return typeof phoneNumber === 'string' ? phoneNumber.replace(NON_DIGIT_PATTERN, '') : '';
}
