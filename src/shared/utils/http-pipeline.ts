import { PayloadTooLargeException, ValidationPipe } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { getCorsConfig } from '../../config/cors.config';
import { REQUEST_BODY_MAX_BYTES } from '../constants/http.constants';

/**
 * Wires the HTTP perimeter: body size limit, schema validation and the CORS allowlist.
 * The application is created with `bodyParser: false` so these parsers own the limit.
 */
export function configureHttpPipeline(app: NestExpressApplication): void {
  app.use(enforceContentLengthLimit);
  app.use(json({ limit: REQUEST_BODY_MAX_BYTES }));
  app.use(urlencoded({ extended: false, limit: REQUEST_BODY_MAX_BYTES }));
  app.useGlobalPipes(buildValidationPipe());
  app.enableCors(buildCorsOptions());
}

/**
 * Caps every request, not only the content types a parser claims.
 * The body parsers cover json and urlencoded; this covers the rest.
 */
export function enforceContentLengthLimit(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const contentLength = Number(request.headers['content-length']);

  if (Number.isFinite(contentLength) && contentLength > REQUEST_BODY_MAX_BYTES) {
    next(new PayloadTooLargeException());
    return;
  }

  next();
}

export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}

export function buildCorsOptions(): CorsOptions {
  const corsConfig = getCorsConfig();

  return {
    origin: corsConfig.allowedOrigins,
    methods: corsConfig.allowedMethods,
    allowedHeaders: corsConfig.allowedHeaders,
    credentials: corsConfig.credentials,
  };
}
