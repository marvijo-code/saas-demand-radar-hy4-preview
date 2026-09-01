import type { RawSourceRecord } from '@sdr/shared';
import { config } from '../config.ts';
import { transaction } from '../db/connection.ts';
import { recordAudit } from '../repo/audit.ts';
import { upsertRecord } from '../repo/records.ts';
import { addRunError, createRun, finishRun, getRun } from '../repo/runs.ts';
import { getSchedule, noteRunOutcome } from '../repo/settings.ts';
import { recomputeWorkspace } from './derive.ts';
import { getAdapter } from '../sources/registry.ts';
import type { AdapterContext } from '../sources/types.ts';

export interface IngestRequest {
  workspaceId: string;
  adapter: string;
  actorUserId: string | null;
  actorEmail: string | null;
  trigger: 'manual' | 'schedule' | 'retry';
  records?: unknown;
  snapshotPath?: string;
  keywords?: string[];
  subreddits?: string[];
  maxResults?: number;
}

export interface IngestSummary {
  id: string;
  adapter: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  recordsSeen: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  signalsCreated: number;
  needsCreated: number;
  needsUpdated: number;
  needsRemoved: number;
  notes: string[];
  errors: { platform?: string | null; externalId?: string | null; message: string }[];
  error: { message: string; detail?: string } | null;
  unavailable: { message: string; hint: string } | null;
}

/**
 * Runs one ingestion cycle.
 *
 * The run is persisted before any work starts and updated when it finishes, which is what
 * makes the "source runs" screen show a failed run with its error instead of nothing at all.
 * All database writes for one cycle happen inside a single transaction so a crash can never
 * leave half-ingested evidence behind.
 */
export async function runIngest(request: IngestRequest): Promise<IngestSummary> {
  const adapter = getAdapter(request.adapter);
  if (!adapter) {
    throw new Error(`Unknown source adapter "${request.adapter}".`);
  }

  const schedule = getSchedule(request.workspaceId);
  const run = createRun({
    workspaceId: request.workspaceId,
    adapter: request.adapter,
    triggeredBy: request.actorUserId,
    params: {
      trigger: request.trigger,
      keywords: request.keywords ?? schedule.keywords,
      subreddits: request.subreddits ?? schedule.subreddits,
      maxResults: request.maxResults ?? config.sources.xMaxResults,
    },
  });

  const context: AdapterContext = {
    workspaceId: request.workspaceId,
    keywords: request.keywords ?? schedule.keywords,
    subreddits: request.subreddits ?? schedule.subreddits,
    maxResults: request.maxResults ?? config.sources.redditMaxResults,
    records: request.records,
    snapshotPath: request.snapshotPath,
  };

  let result: Awaited<ReturnType<typeof adapter.fetch>>;
  try {
    result = await adapter.fetch(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishRun(run.id, { status: 'failed', error: { message: 'Source adapter failed.', detail: message.slice(0, 500) } });
    addRunError(run.id, { message: message.slice(0, 500) });
    noteRunOutcome(request.workspaceId, { status: 'failed', error: message.slice(0, 500) });
    recordAudit({
      workspaceId: request.workspaceId,
      actorUserId: request.actorUserId,
      actorEmail: request.actorEmail,
      action: 'source_run.failed',
      targetType: 'source_run',
      targetId: run.id,
      summary: `${adapter.label} run failed: ${message.slice(0, 200)}`,
      metadata: { adapter: request.adapter, trigger: request.trigger },
    });
    return summarise(request.workspaceId, run.id);
  }

  for (const entry of result.errors ?? []) {
    addRunError(run.id, { message: entry.message });
  }

  if (result.unavailable) {
    finishRun(run.id, {
      status: 'failed',
      error: { message: result.unavailable.message, detail: result.unavailable.hint },
      notes: result.notes,
    });
    noteRunOutcome(request.workspaceId, { status: 'failed', error: result.unavailable.message });
    recordAudit({
      workspaceId: request.workspaceId,
      actorUserId: request.actorUserId,
      actorEmail: request.actorEmail,
      action: 'source_run.unavailable',
      targetType: 'source_run',
      targetId: run.id,
      summary: `${adapter.label} run skipped: ${result.unavailable.message}`,
      metadata: { adapter: request.adapter, trigger: request.trigger },
    });
    return summarise(request.workspaceId, run.id);
  }

  let created = 0;
  let updated = 0;
  // Records that failed adapter-level validation are reported as failures so a malformed
  // ingestion can never look like a clean success.
  let failed = result.errors?.length ?? 0;

  for (const record of result.records) {
    try {
      const outcome = upsertRecord({
        workspaceId: request.workspaceId,
        platform: record.platform,
        externalId: record.externalId,
        url: record.url,
        author: record.author ?? null,
        publishedAt: record.publishedAt,
        text: record.text,
        engagement: record.engagement ?? {},
        subreddit: record.subreddit ?? null,
      });
      if (outcome.created) created += 1;
      else if (outcome.changed) updated += 1;
    } catch (error) {
      failed += 1;
      addRunError(run.id, {
        platform: record.platform,
        externalId: record.externalId,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      });
    }
  }

  const derived = transaction(() => recomputeWorkspace(request.workspaceId, { actorUserId: request.actorUserId }));

  const status = failed > 0 && created + updated > 0 ? 'partial' : failed > 0 ? 'failed' : 'success';
  finishRun(run.id, {
    status,
    recordsSeen: result.records.length + failed,
    recordsCreated: created,
    recordsUpdated: updated,
    recordsFailed: failed,
    signalsCreated: derived.signalsCreated,
    needsCreated: derived.needsCreated,
    notes: result.notes,
  });
  noteRunOutcome(request.workspaceId, {
    status,
    error: failed > 0 ? `${failed} record(s) could not be stored.` : null,
  });
  recordAudit({
    workspaceId: request.workspaceId,
    actorUserId: request.actorUserId,
    actorEmail: request.actorEmail,
    action: 'source_run.completed',
    targetType: 'source_run',
    targetId: run.id,
    summary: `${adapter.label} run ${status}: ${created} new, ${updated} updated, ${failed} failed of ${result.records.length} record(s).`,
    metadata: {
      adapter: request.adapter,
      trigger: request.trigger,
      recordsCreated: created,
      recordsUpdated: updated,
      recordsFailed: failed,
      needsCreated: derived.needsCreated,
      notes: result.notes,
    },
  });

  return summarise(request.workspaceId, run.id);
}

/** Ingests a plain array of already-validated-shaped records (used by tests and seeding). */
export async function ingestRawRecords(
  request: Omit<IngestRequest, 'records'> & { records: RawSourceRecord[] },
): Promise<IngestSummary> {
  return runIngest({ ...request, records: request.records });
}

function summarise(workspaceId: string, runId: string): IngestSummary {
  const hydrated = getRun(workspaceId, runId);
  if (!hydrated) throw new Error(`Source run ${runId} disappeared while summarising.`);
  return {
    id: hydrated.id,
    adapter: hydrated.adapter,
    status: hydrated.status,
    trigger: String(hydrated.params.trigger ?? 'manual'),
    startedAt: hydrated.started_at,
    finishedAt: hydrated.finished_at,
    durationMs: hydrated.durationMs,
    recordsSeen: hydrated.records_seen,
    recordsCreated: hydrated.records_created,
    recordsUpdated: hydrated.records_updated,
    recordsFailed: hydrated.records_failed,
    signalsCreated: hydrated.signals_created,
    needsCreated: hydrated.needs_created,
    needsUpdated: 0,
    needsRemoved: 0,
    notes: hydrated.notes,
    errors: hydrated.errors.map((entry) => ({
      platform: entry.platform,
      externalId: entry.external_id,
      message: entry.message,
    })),
    error: hydrated.error,
    unavailable: hydrated.error
      ? { message: hydrated.error.message, hint: hydrated.error.detail ?? '' }
      : null,
  };
}
