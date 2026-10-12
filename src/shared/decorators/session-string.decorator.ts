import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { readSessionHeader } from '../utils/session-header';

/** Injects the session credential taken from SESSION_HEADER, or an empty string when absent. */
export const SessionString = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  readSessionHeader(context.switchToHttp().getRequest<Request>()),
);
