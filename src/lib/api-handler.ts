import { connection, type NextRequest } from 'next/server';
import type { Logger } from 'pino';
import { z } from 'zod';

import { buildErrorEnvelope, DomainError } from '@/lib/errors';
import { getConfig } from '@/lib/config';
import { createRequestLogger } from '@/lib/logger';
import { REQUEST_ID_HEADER, SURFACE_HEADER } from '@/lib/request-headers';
import { checkRequestOrigin, OriginNotAllowedError } from '@/lib/request-origin';

export interface RequestContext {
  requestId: string;
  logger: Logger;
}

type RouteHandler<TRouteContext> = (
  request: NextRequest,
  routeContext: TRouteContext,
) => Promise<Response>;

type ApiHandlerImplementation<TRouteContext> = (
  request: NextRequest,
  routeContext: TRouteContext,
  requestContext: RequestContext,
) => Promise<Response>;

function respondWithJson(
  body: unknown,
  status: number,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { ...extraHeaders, [REQUEST_ID_HEADER]: requestId },
  });
}

function errorToResponse(error: unknown, requestContext: RequestContext): Response {
  if (error instanceof DomainError) {
    requestContext.logger.info({ errorCode: error.code }, 'domain error');
    return respondWithJson(
      error.toEnvelope(),
      error.httpStatus,
      requestContext.requestId,
      error.responseHeaders(),
    );
  }
  if (error instanceof z.ZodError) {
    const envelope = buildErrorEnvelope('VALIDATION_FAILED', 'Request validation failed', {
      fieldErrors: z.flattenError(error).fieldErrors,
    });
    return respondWithJson(envelope, 400, requestContext.requestId);
  }
  requestContext.logger.error({ err: error }, 'unhandled error');
  const envelope = buildErrorEnvelope('INTERNAL_ERROR', 'Something went wrong');
  return respondWithJson(envelope, 500, requestContext.requestId);
}

export function apiHandler<TRouteContext>(
  implementation: ApiHandlerImplementation<TRouteContext>,
): RouteHandler<TRouteContext> {
  return async (request, routeContext) => {
    await connection();
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
    const requestContext: RequestContext = { requestId, logger: createRequestLogger(requestId) };
    const startedAt = performance.now();
    try {
      const originCheck = checkRequestOrigin(
        {
          method: request.method,
          originHeader: request.headers.get('origin'),
          surface: request.headers.get(SURFACE_HEADER),
        },
        getConfig().surfaces,
      );
      if (!originCheck.allowed) throw new OriginNotAllowedError(originCheck.reason);
      const response = await implementation(request, routeContext, requestContext);
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    } catch (error) {
      return errorToResponse(error, requestContext);
    } finally {
      requestContext.logger.info(
        {
          method: request.method,
          path: request.nextUrl.pathname,
          durationMilliseconds: Math.round(performance.now() - startedAt),
        },
        'request completed',
      );
    }
  };
}
