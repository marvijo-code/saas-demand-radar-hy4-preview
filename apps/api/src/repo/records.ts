import { all, get, run } from '../db/connection.ts';
import type { EngagementCounts, Platform, SignalKind } from '@sdr/shared';

export interface SourceRecordRow {
  id: number;
  workspace_id: string;
  platform: Platform;
  external_id: string;
  url: string;
  author: string | null;
  published_at: string;
  text: string;
  engagement: string;
  subreddit: string | null;
  first_seen_at: string;
  updated_at: string;
}

export interface DemandSignalRow {
  id: number;
  workspace_id: string;
  source_record_id: number;
  kind: SignalKind;
  strength: number;
  matched_phrase: string;
  created_at: string;
}

export function parseEngagement(raw: string): EngagementCounts {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as EngagementCounts;
  } catch {
    /* fall through to empty */
  }
  return {};
}

export function engagementTotal(counts: EngagementCounts): number {
  return Object.values(counts).reduce(
    (sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0),
    0,
  );
}

export function findRecord(
  workspaceId: string,
  platform: Platform,
  externalId: string,
): SourceRecordRow | undefined {
  return get<SourceRecordRow>(
    'SELECT * FROM source_records WHERE workspace_id = ? AND platform = ? AND external_id = ?',
    workspaceId,
    platform,
    externalId,
  );
}

/**
 * Inserts or refreshes one source record.
 *
 * The (workspace, platform, external id) unique constraint is what makes ingestion
 * idempotent: replaying the same run updates the engagement counters instead of creating a
 * second copy of the same public post. `changed` is false when the stored content is already
 * identical, so a repeated run reports zero new records.
 */
export function upsertRecord(input: {
  workspaceId: string;
  platform: Platform;
  externalId: string;
  url: string;
  author: string | null;
  publishedAt: string;
  text: string;
  engagement: EngagementCounts;
  subreddit: string | null;
}): { record: SourceRecordRow; created: boolean; changed: boolean } {
  const now = new Date().toISOString();
  const engagementJson = JSON.stringify(input.engagement);
  const existing = findRecord(input.workspaceId, input.platform, input.externalId);
  if (existing) {
    const changed =
      existing.text !== input.text ||
      existing.url !== input.url ||
      existing.author !== input.author ||
      existing.published_at !== input.publishedAt ||
      existing.engagement !== engagementJson ||
      existing.subreddit !== input.subreddit;
    if (changed) {
      run(
        `UPDATE source_records
           SET url = ?, author = ?, published_at = ?, text = ?, engagement = ?, subreddit = ?, updated_at = ?
         WHERE id = ?`,
        input.url,
        input.author,
        input.publishedAt,
        input.text,
        engagementJson,
        input.subreddit,
        now,
        existing.id,
      );
    }
    const record = findRecord(input.workspaceId, input.platform, input.externalId);
    if (!record) throw new Error('failed to upsert source record');
    return { record, created: false, changed };
  }
  const result = run(
    `INSERT INTO source_records
       (workspace_id, platform, external_id, url, author, published_at, text, engagement, subreddit, first_seen_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.workspaceId,
    input.platform,
    input.externalId,
    input.url,
    input.author,
    input.publishedAt,
    input.text,
    engagementJson,
    input.subreddit,
    now,
    now,
  );
  const record = get<SourceRecordRow>('SELECT * FROM source_records WHERE id = ?', Number(result.lastInsertRowid));
  if (!record) throw new Error('failed to insert source record');
  return { record, created: true, changed: true };
}

export function listWorkspaceRecords(workspaceId: string): SourceRecordRow[] {
  return all<SourceRecordRow>(
    'SELECT * FROM source_records WHERE workspace_id = ? ORDER BY published_at, platform, external_id',
    workspaceId,
  );
}

export function countWorkspaceRecords(workspaceId: string): number {
  const row = get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM source_records WHERE workspace_id = ?',
    workspaceId,
  );
  return row?.count ?? 0;
}

export function listSignals(workspaceId: string): DemandSignalRow[] {
  return all<DemandSignalRow>(
    'SELECT * FROM demand_signals WHERE workspace_id = ? ORDER BY source_record_id, kind',
    workspaceId,
  );
}

export function getRecordById(workspaceId: string, id: number): SourceRecordRow | undefined {
  return get<SourceRecordRow>(
    'SELECT * FROM source_records WHERE workspace_id = ? AND id = ?',
    workspaceId,
    id,
  );
}
