import { all, get, run } from '../db/connection.ts';
import type { RunStatus } from '@sdr/shared';
import { newId } from '../auth/passwords.ts';

export interface SourceRunRow {
  id: string;
  workspace_id: string;
  adapter: string;
  status: RunStatus;
  triggered_by: string | null;
  started_at: string;
  finished_at: string | null;
  records_seen: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  signals_created: number;
  needs_created: number;
  error: string | null;
  params: string;
  notes: string;
}

export interface SourceRunErrorRow {
  id: number;
  run_id: string;
  platform: string | null;
  external_id: string | null;
  message: string;
  created_at: string;
}

export interface SourceRun extends Omit<SourceRunRow, 'params' | 'error' | 'notes'> {
  params: Record<string, unknown>;
  error: { message: string; detail?: string } | null;
  errors: SourceRunErrorRow[];
  notes: string[];
  durationMs: number | null;
}

export function createRun(input: {
  workspaceId: string;
  adapter: string;
  triggeredBy: string | null;
  params?: Record<string, unknown>;
}): SourceRunRow {
  const id = newId('run');
  const now = new Date().toISOString();
  run(
    `INSERT INTO source_runs (id, workspace_id, adapter, status, triggered_by, started_at, params)
     VALUES (?, ?, ?, 'running', ?, ?, ?)`,
    id,
    input.workspaceId,
    input.adapter,
    input.triggeredBy,
    now,
    JSON.stringify(input.params ?? {}),
  );
  const row = get<SourceRunRow>('SELECT * FROM source_runs WHERE id = ?', id);
  if (!row) throw new Error('failed to create source run');
  return row;
}

export function finishRun(
  runId: string,
  patch: {
    status: RunStatus;
    recordsSeen?: number;
    recordsCreated?: number;
    recordsUpdated?: number;
    recordsFailed?: number;
    signalsCreated?: number;
    needsCreated?: number;
    error?: { message: string; detail?: string } | null;
    notes?: string[];
  },
): void {
  const notes = patch.notes ?? [];
  run(
    `UPDATE source_runs SET status = ?, finished_at = ?, records_seen = ?, records_created = ?,
       records_updated = ?, records_failed = ?, signals_created = ?, needs_created = ?, error = ?,
       notes = COALESCE(?, notes)
     WHERE id = ?`,
    patch.status,
    new Date().toISOString(),
    patch.recordsSeen ?? 0,
    patch.recordsCreated ?? 0,
    patch.recordsUpdated ?? 0,
    patch.recordsFailed ?? 0,
    patch.signalsCreated ?? 0,
    patch.needsCreated ?? 0,
    patch.error ? JSON.stringify(patch.error) : null,
    notes.length ? JSON.stringify(notes) : null,
    runId,
  );
}

export function addRunError(
  runId: string,
  error: { platform?: string | null; externalId?: string | null; message: string },
): void {
  run(
    `INSERT INTO source_run_errors (run_id, platform, external_id, message, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    runId,
    error.platform ?? null,
    error.externalId ?? null,
    error.message.slice(0, 500),
    new Date().toISOString(),
  );
}

export function getRun(workspaceId: string, runId: string): SourceRun | undefined {
  const row = get<SourceRunRow>(
    'SELECT * FROM source_runs WHERE id = ? AND workspace_id = ?',
    runId,
    workspaceId,
  );
  return row ? hydrate(row) : undefined;
}

export function listRuns(workspaceId: string, limit = 50): SourceRun[] {
  const rows = all<SourceRunRow>(
    'SELECT * FROM source_runs WHERE workspace_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?',
    workspaceId,
    limit,
  );
  return rows.map(hydrate);
}

export function lastSuccessfulRun(workspaceId: string): SourceRun | undefined {
  const row = get<SourceRunRow>(
    `SELECT * FROM source_runs WHERE workspace_id = ? AND status IN ('success', 'partial')
     ORDER BY finished_at DESC LIMIT 1`,
    workspaceId,
  );
  return row ? hydrate(row) : undefined;
}

function hydrate(row: SourceRunRow): SourceRun {
  const errors = all<SourceRunErrorRow>(
    'SELECT * FROM source_run_errors WHERE run_id = ? ORDER BY id',
    row.id,
  );
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(row.params) as Record<string, unknown>;
  } catch {
    params = {};
  }
  let error: { message: string; detail?: string } | null = null;
  if (row.error) {
    try {
      error = JSON.parse(row.error) as { message: string; detail?: string };
    } catch {
      error = { message: row.error };
    }
  }
  let notes: string[] = [];
  try {
    const parsed = JSON.parse(row.notes ?? '[]') as unknown;
    if (Array.isArray(parsed)) notes = parsed.map((entry) => String(entry));
  } catch {
    notes = [];
  }
  const durationMs =
    row.finished_at && row.started_at
      ? Date.parse(row.finished_at) - Date.parse(row.started_at)
      : null;
  const sourceRun: SourceRun = {
    id: row.id,
    workspace_id: row.workspace_id,
    adapter: row.adapter,
    status: row.status,
    triggered_by: row.triggered_by,
    started_at: row.started_at,
    finished_at: row.finished_at,
    records_seen: row.records_seen,
    records_created: row.records_created,
    records_updated: row.records_updated,
    records_failed: row.records_failed,
    signals_created: row.signals_created,
    needs_created: row.needs_created,
    params,
    error,
    errors,
    notes,
    durationMs,
  };
  return sourceRun;
}
