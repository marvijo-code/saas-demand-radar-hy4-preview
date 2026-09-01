import { Router } from 'express';
import { config } from '../config.ts';
import { asyncHandler, notFoundError, ok } from '../lib/http.ts';
import { auth, requireAuth } from '../auth/session.ts';
import { getRun, listRuns } from '../repo/runs.ts';
import { getSchedule } from '../repo/settings.ts';
import { runIngest } from '../pipeline/ingest.ts';
import { sendIngestResult } from './ingest-result.ts';

export const runsRouter = Router();

/** Visible ingestion history for the signed-in workspace only. */
runsRouter.get(
  '/',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
    const runs = listRuns(context.workspace.id, limit).map((run) => ({
      id: run.id,
      adapter: run.adapter,
      status: run.status,
      trigger: String(run.params.trigger ?? 'manual'),
      triggeredBy: run.triggered_by,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      durationMs: run.durationMs,
      recordsSeen: run.records_seen,
      recordsCreated: run.records_created,
      recordsUpdated: run.records_updated,
      recordsFailed: run.records_failed,
      signalsCreated: run.signals_created,
      needsCreated: run.needs_created,
      notes: run.notes,
      errors: run.errors,
      error: run.error,
    }));
    const schedule = getSchedule(context.workspace.id);
    return ok(res, {
      runs,
      lastSuccessAt: schedule.lastRunAt && schedule.lastStatus !== 'failed' ? schedule.lastRunAt : null,
      schedule: {
        enabled: schedule.enabled,
        intervalMinutes: schedule.intervalMinutes,
        adapter: schedule.adapter,
        lastRunAt: schedule.lastRunAt,
        nextRunAt: schedule.nextRunAt,
        lastStatus: schedule.lastStatus,
        lastError: schedule.lastError,
      },
    });
  }),
);

runsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const run = getRun(context.workspace.id, String(req.params.id));
    if (!run) throw notFoundError('Source run not found.');
    return ok(res, {
      run: {
        id: run.id,
        adapter: run.adapter,
        status: run.status,
        trigger: String(run.params.trigger ?? 'manual'),
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        durationMs: run.durationMs,
        records: {
          seen: run.records_seen,
          created: run.records_created,
          updated: run.records_updated,
          failed: run.records_failed,
        },
        signalsCreated: run.signals_created,
        needsCreated: run.needs_created,
        notes: run.notes,
        errors: run.errors,
        error: run.error,
        params: run.params,
      },
    });
  }),
);

/**
 * Re-runs a previous ingestion. The retry reuses the parameters of the original run so the
 * history shows exactly what was retried.
 */
runsRouter.post(
  '/:id/retry',
  requireAuth,
  asyncHandler(async (req, res) => {
    const context = auth(req);
    const original = getRun(context.workspace.id, String(req.params.id));
    if (!original) throw notFoundError('Source run not found.');
    const params = original.params as {
      keywords?: string[];
      subreddits?: string[];
      maxResults?: number;
    };
    const summary = await runIngest({
      workspaceId: context.workspace.id,
      adapter: original.adapter,
      actorUserId: context.user.id,
      actorEmail: context.user.email,
      trigger: 'retry',
      keywords: Array.isArray(params.keywords) ? params.keywords.map(String) : [],
      subreddits: Array.isArray(params.subreddits) ? params.subreddits.map(String) : [],
      maxResults: typeof params.maxResults === 'number' ? params.maxResults : undefined,
      snapshotPath: (original.params as { snapshotPath?: string }).snapshotPath,
    });
    return sendIngestResult(res, summary);
  }),
);

export const scheduleTickMs = config.scheduler.tickMs;
