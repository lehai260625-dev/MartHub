import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { requestIdSchema } from '@marthub/contracts';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function installPlatform(
  app,
  {
    origin = 'http://localhost:3000',
    logger = (record) => process.stdout.write(JSON.stringify(record) + '\n'),
  } = {},
) {
  app.use((req, res, next) => {
    const candidate = req.get('x-request-id');
    req.requestId = requestIdSchema.safeParse(candidate).success
      ? candidate
      : randomUUID();
    res.set('X-Request-Id', req.requestId);
    const started = performance.now();
    res.on('finish', () => {
      // Allowlist only metadata: no URL query, headers, body, address, or raw errors.
      const record = {
        level: res.statusCode >= 500 ? 'error' : 'info',
        requestId: req.requestId,
        method: req.method,
        route: req.route?.path || 'unmatched',
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
        code: res.locals.errorCode,
      };
      try {
        logger(record);
      } catch {
        /* Logging must never alter an HTTP outcome. */
      }
    });
    next();
  });
  app.use(helmet());
  app.use((req, res, next) => {
    res.vary('Origin');
    const supplied = req.get('origin');
    if (supplied && supplied !== origin)
      return next(
        new ApiError(
          403,
          'ORIGIN_NOT_ALLOWED',
          'Request origin is not allowed.',
        ),
      );
    if (supplied) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Access-Control-Expose-Headers', 'X-Request-Id');
    }
    if (req.method === 'OPTIONS') {
      if (!supplied)
        return next(
          new ApiError(
            403,
            'CORS_NOT_ALLOWED',
            'Preflight origin is required.',
          ),
        );
      const method = req.get('access-control-request-method');
      const headers = (req.get('access-control-request-headers') || '')
        .toLowerCase()
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (
        !['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ||
        headers.some(
          (value) =>
            ![
              'authorization',
              'content-type',
              'x-request-id',
              'idempotency-key',
            ].includes(value),
        )
      ) {
        return next(
          new ApiError(
            403,
            'CORS_NOT_ALLOWED',
            'Preflight request is not allowed.',
          ),
        );
      }
      res.set(
        'Access-Control-Allow-Methods',
        'GET, HEAD, POST, PUT, PATCH, DELETE',
      );
      res.set(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, X-Request-Id, Idempotency-Key',
      );
      return res.sendStatus(204);
    }
    next();
  });
  app.use((req, res, next) => {
    const hasBody =
      Number(req.get('content-length')) > 0 ||
      Boolean(req.get('transfer-encoding'));
    if (hasBody && !req.is('application/json'))
      return next(
        new ApiError(
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'Request bodies must use application/json.',
        ),
      );
    next();
  });
  const parseJson = express.json({ limit: '100kb', strict: true });
  app.use((req, res, next) =>
    parseJson(req, res, (error) => {
      if (error?.status === 400)
        return next(
          new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON.'),
        );
      next(error);
    }),
  );
}

export function notFound(req, res, next) {
  next(new ApiError(404, 'NOT_FOUND', 'Resource not found.'));
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let normalized = error;
  if (error.type === 'entity.parse.failed')
    normalized = new ApiError(
      400,
      'INVALID_JSON',
      'Request body is not valid JSON.',
    );
  else if (error.type === 'entity.too.large')
    normalized = new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      'Request body exceeds 100 KB.',
    );
  else if (error.status === 415)
    normalized = new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Request encoding is not supported.',
    );
  if (!(normalized instanceof ApiError))
    normalized = new ApiError(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred.',
    );
  res.locals.errorCode = normalized.code;
  if (
    normalized.status === 429 &&
    Number.isInteger(normalized.retryAfter) &&
    normalized.retryAfter > 0
  ) {
    res.set('Retry-After', String(normalized.retryAfter));
  }
  res.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details ? { details: normalized.details } : {}),
      requestId: req.requestId,
    },
  });
}
