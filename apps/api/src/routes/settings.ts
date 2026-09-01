import { Router } from 'express';
import { asyncHandler, ok } from '../lib/http.ts';
import { asBoolean, asEnum, asInt, asObject, asOptionalString, asStringArray } from '../lib/validate.ts';
import { auth, requireAuth } from '../auth/session.ts';
import { getSchedule, updateSchedule } from '../repo/settings.ts';
import { recordAudit } from '../repo/audit.ts';
import { ADAPTER_IDS } from '../sources/registry.ts';
import { config } from '../config.ts';

export const settingsRouter = Router();

settingsRouter.get(
  '/schedule',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const schedule = getSchedule(context.workspace.id);
    return ok(res, {
      schedule: {
        ...schedule,
        schedulerEnabled: config.scheduler.enabled,
        availableAdapters: ADAPTER_IDS,
      },
    });
  }),
);

/**
 * Updates the scheduled-ingestion configuration.
 * Changing the interval reschedules `nextRunAt` from the last run so the change is visible
 * immediately instead of only after the next tick.
 */
settingsRouter.put(
  '/schedule',
  requireAuth,
  asyncHandler((req, res) => {
    const context = auth(req);
    const body = asObject(req.body);
    const enabled = body.enabled === undefined ? undefined : asBoolean(body.enabled, 'enabled');
    const intervalMinutes =
      body.intervalMinutes === undefined && body.interval_minutes === undefined
        ? undefined
        : asInt(body.intervalMinutes ?? body.interval_minutes, 'intervalMinutes', {
            min: 5,
            max: 60 * 24 * 30,
          });
    const adapter =
      body.adapter === undefined
        ? undefined
        : asEnum(body.adapter, 'adapter', ADAPTER_IDS);
    const keywords = body.keywords === undefined ? undefined : asStringArray(body.keywords, 'keywords');
    const subreddits =
      body.subreddits === undefined ? undefined : asStringArray(body.subreddits, 'subreddits');
    const snapshotPath =
      body.snapshotPath === undefined && body.snapshot_path === undefined
        ? undefined
        : asOptionalString(body.snapshotPath ?? body.snapshot_path, 'snapshotPath', { max: 500 });

    const current = getSchedule(context.workspace.id);
    const nextInterval = intervalMinutes ?? current.intervalMinutes;
    const base = current.lastRunAt ? Date.parse(current.lastRunAt) : Date.now();
    updateSchedule(context.workspace.id, {
      enabled,
      intervalMinutes,
      adapter,
      keywords,
      subreddits,
      snapshotPath,
      nextRunAt: new Date(base + nextInterval * 60_000).toISOString(),
    });
    const schedule = getSchedule(context.workspace.id);
    recordAudit({
      workspaceId: context.workspace.id,
      actorUserId: context.user.id,
      actorEmail: context.user.email,
      action: 'schedule.updated',
      targetType: 'schedule_settings',
      targetId: context.workspace.id,
      summary: `${context.user.email} ${
        schedule.enabled ? 'enabled' : 'disabled'
      } scheduled ingestion every ${schedule.intervalMinutes} minute(s) via ${schedule.adapter}.`,
      metadata: { schedule },
    });
    return ok(res, {
      schedule: {
        ...schedule,
        schedulerEnabled: config.scheduler.enabled,
        availableAdapters: ADAPTER_IDS,
      },
    });
  }),
);
