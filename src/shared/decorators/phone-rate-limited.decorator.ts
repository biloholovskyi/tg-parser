import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

export const IS_PHONE_RATE_LIMITED_KEY = 'isPhoneRateLimited';

/**
 * Marks a route whose cost is charged to the Telegram application rather than to the caller,
 * so it is counted per phone number — see .claude/rules/api-security.md (RATE_LIMIT_AUTH).
 */
export const PhoneRateLimited = (): CustomDecorator<string> =>
  SetMetadata(IS_PHONE_RATE_LIMITED_KEY, true);
