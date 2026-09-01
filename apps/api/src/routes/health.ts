import { Router } from 'express';
import { config } from '../config.ts';
import { describeAdapters } from '../sources/registry.ts';
import { ok } from '../lib/http.ts';
import { countWorkspaceRecords } from '../repo/records.ts';
import { auth, getAuthContext } from '../auth/session.ts';

export const healthRouter = Router();

/**
 * Unauthenticated liveness probe required by the interoperability contract.
 * Always answers `{ status: "ok" }` while the process can serve traffic.
 */
healthRouter.get('/health', (_req, res) => {
  ok(res, {
    status: 'ok',
    service: 'saas-demand-radar-api',
    version: '1.0.0',
    environment: config.nodeEnv,
    time: new Date().toISOString(),
    web: `http://127.0.0.1:${config.webPort}`,
  });
});

/** Feature discovery used by the UI to explain which adapters can actually run here. */
healthRouter.get('/capabilities', (_req, res) => {
  ok(res, {
    status: 'ok',
    adapters: describeAdapters(),
    windows: ['24h', '7d', '30d', 'all'],
    sorts: ['score', 'recency', 'frequency', 'engagement', 'title'],
    statuses: ['new', 'reviewing', 'validated', 'dismissed'],
  });
});

/** Small authenticated probe used by the web app to detect an expired session. */
healthRouter.get('/session-check', (req, res) => {
  const context = getAuthContext(req);
  if (!context) {
    ok(res, { authenticated: false });
    return;
  }
  ok(res, {
    authenticated: true,
    workspaceId: context.workspace.id,
    records: countWorkspaceRecords(auth(req).workspace.id),
  });
});
