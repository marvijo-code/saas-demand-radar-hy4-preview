import { all, get, run } from '../db/connection.ts';

export interface FeedbackRow {
  id: number;
  workspace_id: string;
  user_id: string;
  target_type: 'need' | 'evidence';
  need_id: number | null;
  source_record_id: number | null;
  relevant: number | null;
  willingness_to_pay: number;
  contacted: number;
  note: string | null;
  created_at: string;
}

export interface NewFeedback {
  workspaceId: string;
  userId: string;
  targetType: 'need' | 'evidence';
  needId: number | null;
  sourceRecordId: number | null;
  relevant: boolean | null;
  willingnessToPay: boolean;
  contacted: boolean;
  note: string | null;
}

export interface FeedbackWithActor extends FeedbackRow {
  actor_email: string | null;
}

export function insertFeedback(input: NewFeedback): FeedbackRow {
  const now = new Date().toISOString();
  const result = run(
    `INSERT INTO feedback
       (workspace_id, user_id, target_type, need_id, source_record_id, relevant,
        willingness_to_pay, contacted, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.workspaceId,
    input.userId,
    input.targetType,
    input.needId,
    input.sourceRecordId,
    input.relevant === null ? null : input.relevant ? 1 : 0,
    input.willingnessToPay ? 1 : 0,
    input.contacted ? 1 : 0,
    input.note,
    now,
  );
  const row = get<FeedbackRow>('SELECT * FROM feedback WHERE id = ?', Number(result.lastInsertRowid));
  if (!row) throw new Error('failed to insert feedback');
  return row;
}

export function listWorkspaceFeedback(workspaceId: string, limit = 500): FeedbackWithActor[] {
  return all<FeedbackWithActor>(
    `SELECT f.*, u.email AS actor_email
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.workspace_id = ?
     ORDER BY f.created_at DESC, f.id DESC
     LIMIT ?`,
    workspaceId,
    limit,
  );
}

export function listFeedbackForNeed(workspaceId: string, needId: number): FeedbackWithActor[] {
  return all<FeedbackWithActor>(
    `SELECT f.*, u.email AS actor_email
     FROM feedback f
     LEFT JOIN users u ON u.id = f.user_id
     WHERE f.workspace_id = ? AND (f.need_id = ? OR f.source_record_id IN (
       SELECT source_record_id FROM need_evidence WHERE workspace_id = ? AND need_id = ?
     ))
     AND NOT (f.target_type = 'evidence' AND f.need_id = ? AND f.source_record_id IS NULL)
     ORDER BY f.created_at DESC, f.id DESC`,
    workspaceId,
    needId,
    workspaceId,
    needId,
    needId,
  );
}

export function countFeedback(workspaceId: string): {
  total: number;
  relevant: number;
  irrelevant: number;
  willingnessToPay: number;
  contacted: number;
} {
  const row = get<Record<string, number>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN relevant = 1 THEN 1 ELSE 0 END) AS relevant,
            SUM(CASE WHEN relevant = 0 THEN 1 ELSE 0 END) AS irrelevant,
            SUM(CASE WHEN willingness_to_pay = 1 THEN 1 ELSE 0 END) AS willingnessToPay,
            SUM(CASE WHEN contacted = 1 THEN 1 ELSE 0 END) AS contacted
     FROM feedback WHERE workspace_id = ?`,
    workspaceId,
  );
  return {
    total: Number(row?.total ?? 0),
    relevant: Number(row?.relevant ?? 0),
    irrelevant: Number(row?.irrelevant ?? 0),
    willingnessToPay: Number(row?.willingnessToPay ?? 0),
    contacted: Number(row?.contacted ?? 0),
  };
}
