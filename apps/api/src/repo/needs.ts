import { all, get, run } from '../db/connection.ts';
import type { NeedStatus, Platform, ScoreBreakdown, SignalKind } from '@sdr/shared';

export interface NeedRow {
  id: number;
  workspace_id: string;
  key: string;
  title: string;
  summary: string;
  status: NeedStatus;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface NeedScoreRow {
  id: number;
  workspace_id: string;
  need_id: number;
  model_version: number;
  score: number;
  rank: number | null;
  breakdown: string;
  computed_at: string;
}

export interface NeedEvidenceJoinRow {
  need_id: number;
  record_id: number;
  platform: Platform;
  external_id: string;
  url: string;
  author: string | null;
  published_at: string;
  text: string;
  engagement: string;
  subreddit: string | null;
}

export function listNeeds(workspaceId: string): NeedRow[] {
  return all<NeedRow>('SELECT * FROM needs WHERE workspace_id = ? ORDER BY id', workspaceId);
}

export function getNeedRow(workspaceId: string, needId: number): NeedRow | undefined {
  return get<NeedRow>('SELECT * FROM needs WHERE workspace_id = ? AND id = ?', workspaceId, needId);
}

export function getNeedByKey(workspaceId: string, key: string): NeedRow | undefined {
  return get<NeedRow>('SELECT * FROM needs WHERE workspace_id = ? AND key = ?', workspaceId, key);
}

export function upsertNeed(input: {
  workspaceId: string;
  key: string;
  title: string;
  summary: string;
  firstSeenAt: string;
  lastSeenAt: string;
}): { need: NeedRow; created: boolean } {
  const existing = getNeedByKey(input.workspaceId, input.key);
  const now = new Date().toISOString();
  if (existing) {
    run(
      `UPDATE needs SET title = ?, summary = ?, first_seen_at = ?, last_seen_at = ?, updated_at = ?
       WHERE id = ?`,
      input.title,
      input.summary,
      input.firstSeenAt,
      input.lastSeenAt,
      now,
      existing.id,
    );
    return { need: { ...existing, ...input, workspace_id: input.workspaceId, updated_at: now } as NeedRow, created: false };
  }
  const result = run(
    `INSERT INTO needs (workspace_id, key, title, summary, status, first_seen_at, last_seen_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
    input.workspaceId,
    input.key,
    input.title,
    input.summary,
    input.firstSeenAt,
    input.lastSeenAt,
    now,
    now,
  );
  const need = get<NeedRow>('SELECT * FROM needs WHERE id = ?', Number(result.lastInsertRowid));
  if (!need) throw new Error('failed to insert need');
  return { need, created: true };
}

export function linkEvidence(workspaceId: string, needId: number, sourceRecordId: number): boolean {
  const result = run(
    `INSERT OR IGNORE INTO need_evidence (workspace_id, need_id, source_record_id, added_at)
     VALUES (?, ?, ?, ?)`,
    workspaceId,
    needId,
    sourceRecordId,
    new Date().toISOString(),
  );
  return result.changes > 0;
}

export function listNeedEvidence(workspaceId: string): NeedEvidenceJoinRow[] {
  return all<NeedEvidenceJoinRow>(
    `SELECT ne.need_id, sr.id AS record_id, sr.platform, sr.external_id, sr.url, sr.author,
            sr.published_at, sr.text, sr.engagement, sr.subreddit
     FROM need_evidence ne
     JOIN source_records sr ON sr.id = ne.source_record_id
     WHERE ne.workspace_id = ?
     ORDER BY sr.published_at DESC, sr.id`,
    workspaceId,
  );
}

export function pruneEvidence(needId: number, keepRecordIds: number[]): number {
  if (!keepRecordIds.length) {
    return run('DELETE FROM need_evidence WHERE need_id = ?', needId).changes;
  }
  const placeholders = keepRecordIds.map(() => '?').join(', ');
  return run(
    `DELETE FROM need_evidence WHERE need_id = ? AND source_record_id NOT IN (${placeholders})`,
    needId,
    ...keepRecordIds,
  ).changes;
}

export function deleteNeedsWithoutEvidence(workspaceId: string): number {
  return run(
    `DELETE FROM needs
     WHERE workspace_id = ?
       AND NOT EXISTS (SELECT 1 FROM need_evidence WHERE need_evidence.need_id = needs.id)
       AND NOT EXISTS (SELECT 1 FROM feedback WHERE feedback.need_id = needs.id)`,
    workspaceId,
  ).changes;
}

export function updateNeedStatus(workspaceId: string, needId: number, status: NeedStatus): boolean {
  return (
    run(
      'UPDATE needs SET status = ?, updated_at = ? WHERE id = ? AND workspace_id = ?',
      status,
      new Date().toISOString(),
      needId,
      workspaceId,
    ).changes > 0
  );
}

export function saveScore(input: {
  workspaceId: string;
  needId: number;
  modelVersion: number;
  score: number;
  rank: number | null;
  breakdown: ScoreBreakdown;
}): void {
  run(
    `INSERT INTO need_scores (workspace_id, need_id, model_version, score, rank, breakdown, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (need_id, model_version) DO UPDATE SET
       score = excluded.score,
       rank = excluded.rank,
       breakdown = excluded.breakdown,
       computed_at = excluded.computed_at`,
    input.workspaceId,
    input.needId,
    input.modelVersion,
    input.score,
    input.rank,
    JSON.stringify(input.breakdown),
    new Date().toISOString(),
  );
}

export function listScores(workspaceId: string, modelVersion: number): NeedScoreRow[] {
  return all<NeedScoreRow>(
    'SELECT * FROM need_scores WHERE workspace_id = ? AND model_version = ?',
    workspaceId,
    modelVersion,
  );
}

export function listScoreHistory(workspaceId: string, needId: number): NeedScoreRow[] {
  return all<NeedScoreRow>(
    'SELECT * FROM need_scores WHERE workspace_id = ? AND need_id = ? ORDER BY model_version',
    workspaceId,
    needId,
  );
}

export function listSignalKinds(workspaceId: string, needId: number): SignalKind[] {
  const rows = all<{ kind: SignalKind }>(
    `SELECT DISTINCT ds.kind
     FROM demand_signals ds
     JOIN need_evidence ne ON ne.source_record_id = ds.source_record_id
     WHERE ds.workspace_id = ? AND ne.need_id = ?
     ORDER BY ds.kind`,
    workspaceId,
    needId,
  );
  return rows.map((row) => row.kind);
}
