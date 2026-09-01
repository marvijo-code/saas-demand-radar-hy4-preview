import { Router } from 'express';
import { asyncHandler, ok } from '../lib/http.ts';
import { auth, requireAuth } from '../auth/session.ts';
import { listAudit } from '../repo/audit.ts';

export const auditRouter = Router();

/** Workspace-scoped audit trail. A workspace can never read another workspace's events. */
auditRouter.get(
  '/',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
    const events = listAudit(context.workspace.id, { action, limit });
    return ok(res, {
      events: events.map((event) => ({
        id: event.id,
        action: event.action,
        targetType: event.target_type,
        targetId: event.target_id,
        summary: event.summary,
        actorEmail: event.actor_email,
        metadata: event.metadata,
        createdAt: event.created_at,
      })),
      total: events.length,
      actions: Array.from(new Set(events.map((event) => event.action))).sort(),
    });
  }),
);
