import type { NextFunction, Request, Response } from 'express';

/**
 * Application error that carries the HTTP status, a stable machine readable code and an
 * optional `details` payload used by the web app to render field level validation errors.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, 'bad_request', message, details);

export const invalid = (message: string, details?: unknown): HttpError =>
  new HttpError(422, 'validation_failed', message, details);

export const unauthorized = (message = 'Sign in to continue.'): HttpError =>
  new HttpError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have access to this resource.'): HttpError =>
  new HttpError(403, 'forbidden', message);

export const notFoundError = (message = 'Not found.'): HttpError =>
  new HttpError(404, 'not_found', message);

export const conflict = (message: string, details?: unknown): HttpError =>
  new HttpError(409, 'conflict', message, details);

export const tooManyRequests = (message: string, retryAfterSeconds: number): HttpError =>
  new HttpError(429, 'rate_limited', message, { retryAfterSeconds });

export const serviceUnavailable = (message: string, details?: unknown): HttpError =>
  new HttpError(503, 'service_unavailable', message, details);

type Handler = (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>;

/** Wraps an async express handler so rejected promises reach the error middleware. */
export function asyncHandler(handler: Handler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function errorBody(error: HttpError): ApiErrorBody {
  const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
  if (error.details !== undefined) body.error.details = error.details;
  return body;
}

/** 404 handler for unknown routes. JSON for `/api/*`, an SPA fallback otherwise. */
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith('/api/')) {
    res.status(404).json(errorBody(notFoundError(`No API route for ${req.method} ${req.path}`)));
    return;
  }
  next();
}

/**
 * Central error handler. Unexpected errors are logged but never leak stack traces or
 * internals to the caller.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof HttpError) {
    if (error.status === 429 && error.details && typeof error.details === 'object') {
      const retryAfter = (error.details as { retryAfterSeconds?: number }).retryAfterSeconds;
      if (typeof retryAfter === 'number') res.setHeader('Retry-After', String(retryAfter));
    }
    res.status(error.status).json(errorBody(error));
    return;
  }
  // Body-parser and other libraries throw plain errors carrying a 4xx `status`; those are
  // client problems (malformed JSON, entity too large) and must not be reported as a 500.
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    const message = error instanceof Error ? error.message : 'Invalid request.';
    res.status(status).json({ error: { code: 'bad_request', message } });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  // eslint-disable-next-line no-console
  console.error(`[api] ${req.method} ${req.path} failed:`, error);
  res.status(500).json({ error: { code: 'internal_error', message } });
}

/** Small helper so route handlers read as `return ok(res, payload)`. */
export function ok(res: Response, payload: unknown, status = 200): Response {
  return res.status(status).json(payload);
}

export function created(res: Response, payload: unknown): Response {
  return res.status(201).json(payload);
}
