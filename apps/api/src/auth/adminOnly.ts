import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/http.ts';
import { getAuthContext } from './session.ts';

/**
 * The single place that decides which mutations require the Admin role.
 *
 * The guard is applied centrally in `createApp()` instead of per router, so a new state
 * changing route can never silently become available to Members: if it should be
 * Admin-only it is registered here, and if it is not listed here it stays open.
 *
 * The split is deliberate:
 *   - Admin-only: anything that changes data or configuration for the *whole workspace*
 *     (ingestion, retries, the ingestion schedule, team membership, and cutting a new
 *     ranking-model version).
 *   - Open to both roles: a reviewer recording their own judgement (need and evidence
 *     feedback, triage status), because that is the collaboration the product exists for.
 */
export interface AdminOnlyMutation {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Matched against `req.originalUrl` without the query string. */
  path: RegExp;
  description: string;
}

export const ADMIN_ONLY_MUTATIONS: readonly AdminOnlyMutation[] = [
  {
    method: 'POST',
    path: /^\/api\/sources\/ingest$/,
    description: 'Running a source ingestion',
  },
  {
    method: 'POST',
    path: /^\/api\/source-runs\/[^/]+\/retry$/,
    description: 'Retrying a previous source run',
  },
  {
    method: 'PUT',
    path: /^\/api\/settings\/schedule$/,
    description: 'Changing the scheduled-ingestion settings',
  },
  {
    method: 'POST',
    path: /^\/api\/ranking\/rescore$/,
    description: 'Cutting a new ranking-model version',
  },
  {
    method: 'PUT',
    path: /^\/api\/team\/name$/,
    description: 'Renaming the workspace',
  },
  {
    method: 'POST',
    path: /^\/api\/team\/members$/,
    description: 'Inviting a member',
  },
  {
    method: 'PATCH',
    path: /^\/api\/team\/members\/[^/]+$/,
    description: 'Changing a member role',
  },
  {
    method: 'DELETE',
    path: /^\/api\/team\/members\/[^/]+$/,
    description: 'Removing a member',
  },
];

export function isAdminOnly(method: string, url: string): AdminOnlyMutation | undefined {
  const path = url.split('?')[0];
  return ADMIN_ONLY_MUTATIONS.find(
    (entry) => entry.method === method.toUpperCase() && entry.path.test(path),
  );
}

/**
 * Answers 401 for an anonymous caller and 403 for a Member on every Admin-only mutation.
 * Read access is untouched, so Members keep the whole product surface for reviewing.
 */
export function requireAdminForMutations(req: Request, _res: Response, next: NextFunction): void {
  const match = isAdminOnly(req.method, req.originalUrl);
  if (!match) {
    next();
    return;
  }
  const context = getAuthContext(req);
  if (!context) {
    next(new HttpError(401, 'unauthorized', 'Sign in to continue.'));
    return;
  }
  if (context.user.role !== 'admin') {
    next(
      new HttpError(
        403,
        'forbidden',
        `${match.description} requires the Admin role.`,
      ),
    );
    return;
  }
  next();
}
