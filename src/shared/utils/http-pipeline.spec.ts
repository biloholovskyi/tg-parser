import { Body, Controller, Get, Module, PayloadTooLargeException, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IsNotEmpty, IsString } from 'class-validator';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { CORS_ORIGINS_ENV_VAR } from '../../config/cors.config';
import { REQUEST_BODY_MAX_BYTES } from '../constants/http.constants';
import { configureHttpPipeline, enforceContentLengthLimit } from './http-pipeline';

const PROBE_ROUTE = '/probe';
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const OVERSIZE_OVERSHOOT_BYTES = 2;
const JSON_ENVELOPE_BYTES = 14;
const UNDER_LIMIT_MARGIN_BYTES = 2;
const INPUT_ALLOWED_ORIGIN = 'https://allowed.example.com';
const INPUT_FOREIGN_ORIGIN = 'https://foreign.example.com';
const INPUT_VALID_PAYLOAD = 'fake-payload';
const INPUT_NUMERIC_PAYLOAD = 42;
const CONTENT_TYPE_HEADER = 'Content-Type';
const CONTENT_TYPE_JSON = 'application/json';
const CONTENT_TYPE_TEXT = 'text/plain';
const CORS_ORIGIN_HEADER = 'access-control-allow-origin';

const mockHandler = jest.fn();

class ProbeDto {
  @IsString()
  @IsNotEmpty()
  payload: string;
}

@Controller(PROBE_ROUTE)
class ProbeController {
  @Get()
  read(): { ok: boolean } {
    mockHandler();

    return { ok: true };
  }

  @Post()
  write(@Body() inputBody: ProbeDto): { payloadLength: number } {
    mockHandler(inputBody);

    return { payloadLength: inputBody.payload.length };
  }
}

@Module({ controllers: [ProbeController] })
class TestModule {}

async function createTestApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(TestModule, {
    logger: false,
    bodyParser: false,
  });

  configureHttpPipeline(app);
  await app.init();

  return app;
}

/** Builds a JSON body whose serialized length is exactly `totalBytes`. */
function buildJsonBodyOfSize(totalBytes: number): string {
  return JSON.stringify({ payload: 'f'.repeat(totalBytes - JSON_ENVELOPE_BYTES) });
}

describe('configureHttpPipeline', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockHandler.mockClear();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('validation pipe', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      process.env = { ...originalEnv, [CORS_ORIGINS_ENV_VAR]: INPUT_ALLOWED_ORIGIN };
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
      process.env = originalEnv;
    });

    it('passes a valid body through to the handler', async () => {
      const inputBody = { payload: INPUT_VALID_PAYLOAD };

      const actualResponse = await request(app.getHttpServer()).post(PROBE_ROUTE).send(inputBody);

      expect(actualResponse.status).toBe(HTTP_CREATED);
      expect(actualResponse.body).toEqual({ payloadLength: INPUT_VALID_PAYLOAD.length });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('rejects a body with an unknown extra field and never reaches the handler', async () => {
      const inputBody = { payload: INPUT_VALID_PAYLOAD, unexpectedField: 'fake-extra' };

      const actualResponse = await request(app.getHttpServer()).post(PROBE_ROUTE).send(inputBody);

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('rejects a body that violates a DTO constraint and never reaches the handler', async () => {
      const inputBody = { payload: '' };

      const actualResponse = await request(app.getHttpServer()).post(PROBE_ROUTE).send(inputBody);

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('rejects a JSON number sent for a string field instead of converting it', async () => {
      const inputBody = { payload: INPUT_NUMERIC_PAYLOAD };

      const actualResponse = await request(app.getHttpServer()).post(PROBE_ROUTE).send(inputBody);

      expect(actualResponse.status).toBe(HTTP_BAD_REQUEST);
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe('request body size limit', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      process.env = { ...originalEnv, [CORS_ORIGINS_ENV_VAR]: INPUT_ALLOWED_ORIGIN };
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
      process.env = originalEnv;
    });

    it('rejects a JSON body larger than the configured maximum before the handler runs', async () => {
      const inputOversizedPayload = 'f'.repeat(REQUEST_BODY_MAX_BYTES + OVERSIZE_OVERSHOOT_BYTES);

      const actualResponse = await request(app.getHttpServer())
        .post(PROBE_ROUTE)
        .set(CONTENT_TYPE_HEADER, CONTENT_TYPE_JSON)
        .send(JSON.stringify({ payload: inputOversizedPayload }));

      expect(actualResponse.status).toBe(HTTP_PAYLOAD_TOO_LARGE);
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('rejects an oversized body whose content type no body parser claims', async () => {
      const inputOversizedBody = 'f'.repeat(REQUEST_BODY_MAX_BYTES + OVERSIZE_OVERSHOOT_BYTES);

      const actualResponse = await request(app.getHttpServer())
        .get(PROBE_ROUTE)
        .set(CONTENT_TYPE_HEADER, CONTENT_TYPE_TEXT)
        .send(inputOversizedBody);

      expect(actualResponse.status).toBe(HTTP_PAYLOAD_TOO_LARGE);
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('lets a body of an unclaimed content type through while it stays inside the maximum', async () => {
      const inputBody = 'f'.repeat(REQUEST_BODY_MAX_BYTES - UNDER_LIMIT_MARGIN_BYTES);

      const actualResponse = await request(app.getHttpServer())
        .get(PROBE_ROUTE)
        .set(CONTENT_TYPE_HEADER, CONTENT_TYPE_TEXT)
        .send(inputBody);

      expect(actualResponse.status).toBe(HTTP_OK);
      expect(actualResponse.body).toEqual({ ok: true });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('lets a JSON body exactly at the maximum reach the handler', async () => {
      const inputBody = buildJsonBodyOfSize(REQUEST_BODY_MAX_BYTES);

      const actualResponse = await request(app.getHttpServer())
        .post(PROBE_ROUTE)
        .set(CONTENT_TYPE_HEADER, CONTENT_TYPE_JSON)
        .send(inputBody);

      expect(actualResponse.status).toBe(HTTP_CREATED);
      expect(actualResponse.body).toEqual({
        payloadLength: REQUEST_BODY_MAX_BYTES - JSON_ENVELOPE_BYTES,
      });
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('cors allowlist', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      process.env = { ...originalEnv, [CORS_ORIGINS_ENV_VAR]: INPUT_ALLOWED_ORIGIN };
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
      process.env = originalEnv;
    });

    it('echoes an allowlisted origin back to the browser', async () => {
      const inputOrigin = INPUT_ALLOWED_ORIGIN;

      const actualResponse = await request(app.getHttpServer())
        .get(PROBE_ROUTE)
        .set('Origin', inputOrigin);

      expect(actualResponse.status).toBe(HTTP_OK);
      expect(actualResponse.headers[CORS_ORIGIN_HEADER]).toBe(inputOrigin);
    });

    it('sends no allow-origin header for an origin outside the allowlist', async () => {
      const inputOrigin = INPUT_FOREIGN_ORIGIN;

      const actualResponse = await request(app.getHttpServer())
        .get(PROBE_ROUTE)
        .set('Origin', inputOrigin);

      expect(actualResponse.headers[CORS_ORIGIN_HEADER]).toBeUndefined();
    });

    it('serves a server-side request that carries no origin header', async () => {
      const actualResponse = await request(app.getHttpServer()).get(PROBE_ROUTE);

      expect(actualResponse.status).toBe(HTTP_OK);
      expect(actualResponse.body).toEqual({ ok: true });
      expect(actualResponse.headers[CORS_ORIGIN_HEADER]).toBeUndefined();
    });
  });
});

describe('enforceContentLengthLimit', () => {
  const mockResponse = {} as Response;
  let mockNext: jest.Mock;

  function buildRequest(inputContentLength?: string): Request {
    const headers: Record<string, string> = {};

    if (inputContentLength !== undefined) {
      headers['content-length'] = inputContentLength;
    }

    return { headers } as unknown as Request;
  }

  function callMiddleware(inputRequest: Request): void {
    enforceContentLengthLimit(inputRequest, mockResponse, mockNext as unknown as NextFunction);
  }

  beforeEach(() => {
    mockNext = jest.fn();
  });

  it('hands a payload-too-large error to next when the content length exceeds the maximum', () => {
    const inputRequest = buildRequest(String(REQUEST_BODY_MAX_BYTES + OVERSIZE_OVERSHOOT_BYTES));

    callMiddleware(inputRequest);

    expect(mockNext).toHaveBeenCalledTimes(1);
    expect(mockNext.mock.calls[0][0]).toBeInstanceOf(PayloadTooLargeException);
  });

  it('passes a content length exactly at the maximum on without an error', () => {
    const inputRequest = buildRequest(String(REQUEST_BODY_MAX_BYTES));

    callMiddleware(inputRequest);

    expect(mockNext).toHaveBeenCalledWith();
  });

  it('passes a content length below the maximum on without an error', () => {
    const inputRequest = buildRequest(String(REQUEST_BODY_MAX_BYTES - UNDER_LIMIT_MARGIN_BYTES));

    callMiddleware(inputRequest);

    expect(mockNext).toHaveBeenCalledWith();
  });

  it('passes a request carrying no content-length header on without an error', () => {
    const inputRequest = buildRequest();

    callMiddleware(inputRequest);

    expect(mockNext).toHaveBeenCalledWith();
  });

  it('passes a request with a non-numeric content-length on without an error', () => {
    const inputRequest = buildRequest('not-a-number');

    callMiddleware(inputRequest);

    expect(mockNext).toHaveBeenCalledWith();
  });
});
