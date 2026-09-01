import { Router } from 'express';
import { config } from '../config.ts';
import { asyncHandler, ok, unauthorized, HttpError } from '../lib/http.ts';
import { asEmail, asObject, asString } from '../lib/validate.ts';
import { verifyPassword, DUMMY_HASH } from '../auth/passwords.ts';
import {
  cookieOptions,
  createSessionFor,
  destroySession,
  getAuthContext,
} from '../auth/session.ts';
import { findUserByEmail, getWorkspace, listMembers } from '../repo/users.ts';
import { recordAudit } from '../repo/audit.ts';
import { rateLimit } from '../auth/session.ts';

export const authRouter = Router();

interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  workspaceId: string;
}

interface PublicWorkspace {
  id: string;
  name: string;
  slug: string;
}

export function publicUser(user: {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  workspace_id: string;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    workspaceId: user.workspace_id,
  };
}

/**
 * Sign in.
 *
 * The password is verified with scrypt in constant time, and an unknown email costs exactly
 * the same as a wrong password because a dummy hash is derived in both cases. The session is
 * an opaque random token stored in an HTTP-only cookie; nothing is returned to JavaScript.
 */
authRouter.post(
  '/login',
  rateLimit(
    { name: 'login', windowMs: config.rateLimit.loginWindowMs, max: config.rateLimit.loginMax },
    'login',
  ),
  asyncHandler((req, res) => {
    const body = asObject(req.body);
    const email = asEmail(body.email, 'email');
    const password = asString(body.password, 'password', { max: 200, trim: false });

    const user = findUserByEmail(email);
    const storedHash = user?.password_hash ?? DUMMY_HASH;
    const valid = verifyPassword(password, storedHash);
    if (!user || !valid) {
      recordAudit({
        workspaceId: user?.workspace_id ?? null,
        actorUserId: null,
        actorEmail: email,
        action: 'auth.login_failed',
        targetType: 'user',
        targetId: email,
        summary: `Failed sign-in attempt for ${email}.`,
      });
      throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
    }

    const token = createSessionFor(user, req.get('user-agent'));
    res.cookie(config.sessionCookieName, token, cookieOptions(config.sessionTtlHours * 3600));
    const workspace = getWorkspace(user.workspace_id);
    recordAudit({
      workspaceId: user.workspace_id,
      actorUserId: user.id,
      actorEmail: user.email,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      summary: `${user.email} signed in.`,
    });
    return ok(res, {
      user: publicUser(user),
      workspace: workspace
        ? { id: workspace.id, name: workspace.name, slug: workspace.slug }
        : null,
    });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler((req, res) => {
    const context = getAuthContext(req);
    const token: unknown = (req as unknown as { cookies?: Record<string, unknown> }).cookies?.[
      config.sessionCookieName
    ];
    if (context) {
      recordAudit({
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        actorEmail: context.user.email,
        action: 'auth.logout',
        targetType: 'user',
        targetId: context.user.id,
        summary: `${context.user.email} signed out.`,
      });
    }
    destroySession(typeof token === 'string' ? token : undefined);
    res.clearCookie(config.sessionCookieName, cookieOptions(0));
    return ok(res, { ok: true });
  }),
);

authRouter.get(
  '/me',
  asyncHandler((req, res) => {
    const context = getAuthContext(req);
    if (!context) throw unauthorized();
    return ok(res, {
      user: {
        id: context.user.id,
        email: context.user.email,
        name: context.user.name,
        role: context.user.role,
        workspaceId: context.workspace.id,
      },
      workspace: context.workspace,
      members: listMembers(context.workspace.id).map((member) => ({
        id: member.id,
        email: member.email,
        name: member.name,
        role: member.role,
        lastSeenAt: member.last_seen_at,
      })),
    });
  }),
);
