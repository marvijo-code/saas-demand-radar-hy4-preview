import { get, run } from '../db/connection.ts';

export interface ScheduleSettings {
  enabled: boolean;
  intervalMinutes: number;
  adapter: string;
  keywords: string[];
  subreddits: string[];
  snapshotPath: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  updatedAt: string;
}

interface ScheduleRow {
  workspace_id: string;
  enabled: number;
  interval_minutes: number;
  adapter: string;
  keywords: string;
  subreddits: string;
  snapshot_path: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  updated_at: string;
}

function parseList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function hydrate(row: ScheduleRow): ScheduleSettings {
  return {
    enabled: row.enabled === 1,
    intervalMinutes: row.interval_minutes,
    adapter: row.adapter,
    keywords: parseList(row.keywords),
    subreddits: parseList(row.subreddits),
    snapshotPath: row.snapshot_path,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export function getSchedule(workspaceId: string): ScheduleSettings {
  const row = get<ScheduleRow>('SELECT * FROM schedule_settings WHERE workspace_id = ?', workspaceId);
  if (row) return hydrate(row);
  run(
    `INSERT INTO schedule_settings (workspace_id, enabled, interval_minutes, adapter, keywords, subreddits, updated_at)
     VALUES (?, 0, 720, 'snapshot', '[]', '[]', ?)`,
    workspaceId,
    new Date().toISOString(),
  );
  const created = get<ScheduleRow>(
    'SELECT * FROM schedule_settings WHERE workspace_id = ?',
    workspaceId,
  );
  if (!created) throw new Error('failed to initialise schedule settings');
  return hydrate(created);
}

/** Records the outcome of a scheduled (or manual) run and schedules the next one. */
export function noteRunOutcome(
  workspaceId: string,
  outcome: { status: string; error?: string | null; at?: string; intervalMinutes?: number },
): ScheduleSettings {
  const current = getSchedule(workspaceId);
  const at = outcome.at ?? new Date().toISOString();
  const intervalMinutes = outcome.intervalMinutes ?? current.intervalMinutes;
  const nextRunAt = new Date(
    Date.parse(at) + Math.max(5, intervalMinutes) * 60_000,
  ).toISOString();
  run(
    `UPDATE schedule_settings SET last_run_at = ?, next_run_at = ?, last_status = ?, last_error = ?, updated_at = ?
     WHERE workspace_id = ?`,
    at,
    nextRunAt,
    outcome.status,
    outcome.error ?? null,
    new Date().toISOString(),
    workspaceId,
  );
  return getSchedule(workspaceId);
}

export function updateSchedule(
  workspaceId: string,
  patch: Partial<Omit<ScheduleSettings, 'updatedAt'>>,
): ScheduleSettings {
  getSchedule(workspaceId);
  run(
    `UPDATE schedule_settings SET
       enabled = COALESCE(?, enabled),
       interval_minutes = COALESCE(?, interval_minutes),
       adapter = COALESCE(?, adapter),
       keywords = COALESCE(?, keywords),
       subreddits = COALESCE(?, subreddits),
       snapshot_path = COALESCE(?, snapshot_path),
       last_run_at = COALESCE(?, last_run_at),
       next_run_at = COALESCE(?, next_run_at),
       last_status = COALESCE(?, last_status),
       last_error = COALESCE(?, last_error),
       updated_at = ?
     WHERE workspace_id = ?`,
    patch.enabled === undefined ? null : patch.enabled ? 1 : 0,
    patch.intervalMinutes ?? null,
    patch.adapter ?? null,
    patch.keywords ? JSON.stringify(patch.keywords) : null,
    patch.subreddits ? JSON.stringify(patch.subreddits) : null,
    patch.snapshotPath === undefined ? null : patch.snapshotPath,
    patch.lastRunAt ?? null,
    patch.nextRunAt ?? null,
    patch.lastStatus ?? null,
    patch.lastError ?? null,
    new Date().toISOString(),
    workspaceId,
  );
  return getSchedule(workspaceId);
}
