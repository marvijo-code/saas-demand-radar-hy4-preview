import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.ts';
import { HttpError, errorHandler, notFoundHandler, ok } from './lib/http.ts';
import { attachSession, rateLimit } from './auth/session.ts';
import { requireAdminForMutations } from './auth/adminOnly.ts';
import { healthRouter } from './routes/health.ts';
import { authRouter } from './routes/auth.ts';
import { sourcesRouter } from './routes/sources.ts';
import { runsRouter } from './routes/runs.ts';
import { needsRouter } from './routes/needs.ts';
import { rankingRouter } from './routes/ranking.ts';
import { settingsRouter } from './routes/settings.ts';
import { teamRouter } from './routes/team.ts';
import { auditRouter } from './routes/audit.ts';
import { overviewRouter } from './routes/overview.ts';
import { feedbackRouter } from './routes/feedback.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(cors);
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(attachSession);

  // Broad read limit first (keyed by user when signed in, by IP otherwise), then a stricter
  // limit for every state-changing request on top of it.
  app.use(
    '/api',
    rateLimit(
      { name: 'read', windowMs: config.rateLimit.readWindowMs, max: config.rateLimit.readMax },
      'read',
    ),
  );
  // Created once: the limiter keeps its counters in the closure.
  const mutationLimiter = rateLimit(
    {
      name: 'mutation',
      windowMs: config.rateLimit.mutationWindowMs,
      max: config.rateLimit.mutationMax,
    },
    'mutation',
  );
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    mutationLimiter(req, res, next);
  });
  app.use('/api', rejectForeignOrigin);
  // One central guard for every Admin-only mutation (see auth/adminOnly.ts).
  app.use('/api', requireAdminForMutations);

  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/sources', sourcesRouter);
  app.use('/api/source-runs', runsRouter);
  app.use('/api/needs', needsRouter);
  app.use('/api/ranking', rankingRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/team', teamRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/overview', overviewRouter);
  app.use('/api/feedback', feedbackRouter);

  app.get('/api', (_req: Request, res: Response) => {
    ok(res, {
      service: 'saas-demand-radar-api',
      routes: [
        'GET /api/health',
        'GET /api/capabilities',
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'GET /api/auth/me',
        'POST /api/sources/ingest',
        'GET /api/source-runs',
        'GET /api/needs',
        'GET /api/needs/:id',
        'POST /api/needs/:id/feedback',
        'POST /api/ranking/rescore',
        'GET /api/ranking/versions',
        'GET /api/settings/schedule',
        'PUT /api/settings/schedule',
        'GET /api/audit',
      ],
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/** Conservative security headers; the API never serves HTML so the CSP is minimal. */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.setHeader('Cache-Control', 'no-store');
  next();
}

const ALLOWED = new Set(config.corsOrigins);

function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.get('origin');
  if (origin && ALLOWED.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/**
 * Blocks cross-site state changes.
 *
 * The session cookie is `SameSite=Lax`, and this rejects any state-changing request that
 * carries an `Origin` header we do not serve. Clients without an Origin header (curl, server
 * to server calls) are unaffected.
 */
function rejectForeignOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.get('origin');
  if (origin && !ALLOWED.has(origin)) {
    next(new HttpError(403, 'origin_not_allowed', `Origin ${origin} is not allowed.`));
    return;
  }
  next();
}

export const app = createApp();
