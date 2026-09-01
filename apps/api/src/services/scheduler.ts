import { config } from '../config.ts';
import { all } from '../db/connection.ts';
import { getSchedule, noteRunOutcome, updateSchedule } from '../repo/settings.ts';
import { runIngest } from '../pipeline/ingest.ts';
import { listRuns } from '../repo/runs.ts';
import { recordAudit } from '../repo/audit.ts';

/**
 * Exponential backoff for failed scheduled runs.
 * A failing source is retried quickly at first and then backs off, but the run history and
 * the audit trail always show the failure and the retry schedule.
 */
export function retryDelayMinutes(intervalMinutes: number, consecutiveFailures: number): number {
  const safeInterval = Math.max(5, intervalMinutes);
  const backoff = Math.min(safeInterval, 5 * 2 ** Math.max(0, consecutiveFailures - 1));
  return Math.max(1, Math.round(backoff));
}

export function listWorkspaces(): string[] {
  return all<{ id: string }>('SELECT id FROM workspaces ORDER BY id').map((row) => row.id);
}

export function consecutiveFailures(workspaceId: string): number {
  let count = 0;
  for (const run of listRuns(workspaceId, 20)) {
    if (run.status === 'failed') count += 1;
    else break;
  }
  return count;
}

/**
 * Runs one scheduler tick: every workspace whose schedule is enabled and due gets one
 * ingestion run. Errors are captured per workspace so one broken tenant cannot stop the tick.
 */
export async function tick(now = new Date()): Promise<{ executed: string[]; skipped: string[] }> {
  const executed: string[] = [];
  const skipped: string[] = [];
  for (const workspaceId of listWorkspaces()) {
    const schedule = getSchedule(workspaceId);
    if (!schedule.enabled) {
      skipped.push(workspaceId);
      continue;
    }
    const due = !schedule.nextRunAt || Date.parse(schedule.nextRunAt) <= now.getTime();
    if (!due) {
      skipped.push(workspaceId);
      continue;
    }
    try {
      const summary = await runIngest({
        workspaceId,
        adapter: schedule.adapter,
        actorUserId: null,
        actorEmail: 'scheduler',
        trigger: 'schedule',
        keywords: schedule.keywords,
        subreddits: schedule.subreddits,
        snapshotPath: schedule.snapshotPath ?? undefined,
      });
      if (summary.status === 'failed') {
        const failures = consecutiveFailures(workspaceId);
        const delay = retryDelayMinutes(schedule.intervalMinutes, failures);
        updateSchedule(workspaceId, {
          nextRunAt: new Date(now.getTime() + delay * 60_000).toISOString(),
        });
        recordAudit({
          workspaceId,
          actorUserId: null,
          actorEmail: 'scheduler',
          action: 'schedule.retry_planned',
          targetType: 'schedule_settings',
          targetId: workspaceId,
          summary: `Scheduled run failed; next retry in ${delay} minute(s).`,
          metadata: { runId: summary.id, error: summary.error?.message ?? null, failures },
        });
      } else {
        const updated = noteRunOutcome(workspaceId, {
          status: summary.status,
          error: summary.status === 'partial' ? `${summary.recordsFailed} record(s) failed.` : null,
          at: now.toISOString(),
          intervalMinutes: schedule.intervalMinutes,
        });
        void updated;
      }
      executed.push(workspaceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateSchedule(workspaceId, {
        lastStatus: 'failed',
        lastError: message.slice(0, 500),
        nextRunAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      });
      recordAudit({
        workspaceId,
        actorUserId: null,
        actorEmail: 'scheduler',
        action: 'schedule.tick_failed',
        targetType: 'schedule_settings',
        targetId: workspaceId,
        summary: `Scheduled ingestion crashed: ${message.slice(0, 200)}`,
      });
      executed.push(workspaceId);
    }
  }
  return { executed, skipped };
}

let timer: NodeJS.Timeout | null = null;

export function startScheduler(): NodeJS.Timeout | null {
  if (timer || !config.scheduler.enabled) return timer;
  timer = setInterval(() => {
    void tick().catch((error) => {
      // eslint-disable-next-line no-console
      console.error('[scheduler] tick failed:', error);
    });
  }, config.scheduler.tickMs);
  if (typeof timer.unref === 'function') timer.unref();
  // eslint-disable-next-line no-console
  console.log(`[scheduler] enabled, ticking every ${config.scheduler.tickMs}ms`);
  return timer;
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
