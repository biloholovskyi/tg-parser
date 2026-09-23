import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC_ROUTE_KEY = 'isPublicRoute';

/**
 * Marks a route as reachable without caller authentication.
 * Only the health probe carries it — see .claude/rules/api-security.md.
 */
export const PublicRoute = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_ROUTE_KEY, true);
