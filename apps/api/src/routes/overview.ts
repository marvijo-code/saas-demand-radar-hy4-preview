import { Router } from 'express';
import { SIGNAL_LABELS } from '@sdr/shared';
import type { SignalKind } from '@sdr/shared';
import { asyncHandler, ok } from '../lib/http.ts';
import { auth, requireAuth } from '../auth/session.ts';
import { loadGraph } from '../pipeline/graph.ts';
import { listRuns } from '../repo/runs.ts';
import { listWorkspaceFeedback } from '../repo/feedback.ts';
import { latestModel } from '../repo/ranking.ts';
import { getSchedule } from '../repo/settings.ts';
import { listAudit } from '../repo/audit.ts';

export const overviewRouter = Router();

/**
 * Dashboard summary.
 *
 * Every number is derived from real persisted data: with no source records the endpoint
 * reports zeroes and an empty state instead of demo content.
 */
overviewRouter.get(
  '/',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const workspaceId = context.workspace.id;
    const graph = loadGraph(workspaceId);
    const runs = listRuns(workspaceId, 10);
    const feedback = listWorkspaceFeedback(workspaceId, 200);
    const model = latestModel(workspaceId);
    const schedule = getSchedule(workspaceId);
    const audit = listAudit(workspaceId, { limit: 8 });

    const kindCounts = new Map<SignalKind, number>();
    let engagement = 0;
    for (const record of graph.records) {
      engagement += Object.values(record.engagement).reduce(
        (sum, value) => sum + (typeof value === 'number' ? value : 0),
        0,
      );
      for (const signal of record.signals) {
        kindCounts.set(signal.kind, (kindCounts.get(signal.kind) ?? 0) + 1);
      }
    }

    const platformCounts = { x: 0, reddit: 0 };
    for (const record of graph.records) platformCounts[record.platform] += 1;

    return ok(res, {
      workspace: context.workspace,
      counts: {
        records: graph.records.length,
        needs: graph.needs.length,
        signals: graph.records.reduce((sum, record) => sum + record.signals.length, 0),
        engagement,
        feedback: feedback.length,
        runs: runs.length,
      },
      platforms: platformCounts,
      signalBreakdown: Array.from(kindCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([kind, count]) => ({ kind, label: SIGNAL_LABELS[kind], count })),
      topNeeds: graph.needs
        .slice()
        .sort((a, b) => b.evidence.length - a.evidence.length || a.id - b.id)
        .slice(0, 5)
        .map((need) => ({
          id: need.id,
          title: need.title,
          status: need.status,
          evidenceCount: need.evidence.length,
          platforms: Array.from(new Set(need.evidence.map((record) => record.platform))),
          lastSeenAt: need.lastSeenAt,
        })),
      latestRun: runs[0]
        ? {
            id: runs[0].id,
            adapter: runs[0].adapter,
            status: runs[0].status,
            startedAt: runs[0].started_at,
            finishedAt: runs[0].finished_at,
            recordsCreated: runs[0].records_created,
            error: runs[0].error,
          }
        : null,
      schedule: {
        enabled: schedule.enabled,
        intervalMinutes: schedule.intervalMinutes,
        adapter: schedule.adapter,
        lastRunAt: schedule.lastRunAt,
        nextRunAt: schedule.nextRunAt,
        lastStatus: schedule.lastStatus,
        lastError: schedule.lastError,
      },
      model: model
        ? { version: model.version, createdAt: model.createdAt, createdByEmail: model.createdByEmail }
        : null,
      recentActivity: audit.map((event) => ({
        id: event.id,
        action: event.action,
        summary: event.summary,
        actorEmail: event.actor_email,
        createdAt: event.created_at,
      })),
    });
  }),
);
