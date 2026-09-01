import type { NextFunction, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { config } from '../config.ts';
import { tooManyRequests, unauthorized } from '../lib/http.ts';
import { RateLimiter, type RateLimitRule } from '../lib/rateLimit.ts';
import {
  createSession,
  deleteSession,
  findSession,
  findUserById,
  getWorkspace,
  touchSession,
  type UserRow,
} from '../repo/users.ts';
import { sessionToken } from './passwords.ts';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  workspaceId: string;
}

export interface SessionWorkspace {
  id: string;
  name: string;
  slug: string;
}

/**
 * The signed-in context attached to a request.
 *
 * Express' request type is intentionally *not* augmented with a global declaration: every
 * route reads the context through `auth(req)`, which throws when the request is anonymous.
 * That makes it impossible to forget the guard in a new route.
 */
export interface AuthContext {
  user: SessionUser;
  workspace: SessionWorkspace;
  sessionId: string;
}

const CONTEXT = Symbol('sdr.auth');

export function setAuthContext(req: Request, context: AuthContext | null): void {
  (req as unknown as Record<symbol, unknown>)[CONTEXT] = context;
}

export function getAuthContext(req: Request): AuthContext | null {
  return ((req as unknown as Record<symbol, unknown>)[CONTEXT] as AuthContext | undefined) ?? null;
}

export function auth(req: Request): AuthContext {
  const context = getAuthContext(req);
  if (!context) throw unauthorized();
  return context;
}

/** Sessions store only a hash of the cookie value, never the token itself. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function cookieOptions(maxAgeSeconds: number): Record<string, unknown> {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProduction,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function createSessionFor(user: UserRow, userAgent?: string | null): string {
  const token = sessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.sessionTtlHours * 3_600_000);
  createSession({
    id: hashSessionToken(token),
    user_id: user.id,
    workspace_id: user.workspace_id,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    last_seen_at: now.toISOString(),
    user_agent: userAgent ? userAgent.slice(0, 300) : null,
  });
  return token;
}

export function destroySession(token: string | undefined): void {
  if (!token) return;
  deleteSession(hashSessionToken(token));
}

/**
 * Reads the session cookie on every request and attaches the auth context.
 * Route guards are the only thing that enforce authentication, so an anonymous request
 * simply carries no context.
 */
export function attachSession(req: Request, _res: Response, next: NextFunction): void {
  const raw: unknown = (req as unknown as { cookies?: Record<string, unknown> }).cookies?.[
    config.sessionCookieName
  ];
  if (typeof raw !== 'string' || !raw) {
    next();
    return;
  }
  const session = findSession(hashSessionToken(raw));
  if (!session) {
    next();
    return;
  }
  const now = new Date();
  if (Date.parse(session.expires_at) <= now.getTime()) {
    deleteSession(session.id);
    next();
    return;
  }
  const user = findUserById(session.user_id);
  const workspace = user ? getWorkspace(user.workspace_id) : undefined;
  if (!user || !workspace) {
    deleteSession(session.id);
    next();
    return;
  }
  setAuthContext(req, {
    sessionId: session.id,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      workspaceId: user.workspace_id,
    },
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
  });
  if (now.getTime() - Date.parse(session.last_seen_at) > 60_000) {
    touchSession(session.id, now.toISOString());
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!getAuthContext(req)) {
    next(unauthorized());
    return;
  }
  next();
}

/** Per-user (or per-IP when anonymous) rate limit guard. */
export function rateLimit(rule: RateLimitRule, scope: string) {
  const limiter = new RateLimiter(rule);
  return (req: Request, _res: Response, next: NextFunction): void => {
    const context = getAuthContext(req);
    const identity = context?.user.id ?? req.ip ?? 'anonymous';
    const result = limiter.check(`${scope}:${identity}`);
    if (!result.allowed) {
      next(
        tooManyRequests(
          `Too many requests. Try again in ${result.retryAfterSeconds}s.`,
          result.retryAfterSeconds,
        ),
      );
      return;
    }
    next();
  };
}
