import { all, get, run } from '../db/connection.ts';

export interface AuditEventRow {
  id: number;
  workspace_id: string | null;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  summary: string;
  metadata: string;
  created_at: string;
}

export interface AuditEvent extends Omit<AuditEventRow, 'metadata'> {
  metadata: Record<string, unknown>;
}

export function recordAudit(input: {
  workspaceId: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  summary: string;
  metadata?: Record<string, unknown>;
}): AuditEvent {
  const result = run(
    `INSERT INTO audit_events
       (workspace_id, actor_user_id, actor_email, action, target_type, target_id, summary, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.workspaceId,
    input.actorUserId,
    input.actorEmail,
    input.action,
    input.targetType,
    input.targetId === undefined || input.targetId === null ? null : String(input.targetId),
    input.summary,
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString(),
  );
  const row = get<AuditEventRow>(
    'SELECT * FROM audit_events WHERE id = ?',
    Number(result.lastInsertRowid),
  );
  if (!row) throw new Error('failed to record audit event');
  return hydrate(row);
}

export function listAudit(
  workspaceId: string,
  options: { limit?: number; action?: string } = {},
): AuditEvent[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  if (options.action) {
    return all<AuditEventRow>(
      'SELECT * FROM audit_events WHERE workspace_id = ? AND action = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      workspaceId,
      options.action,
      limit,
    ).map(hydrate);
  }
  return all<AuditEventRow>(
    'SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    workspaceId,
    limit,
  ).map(hydrate);
}

function hydrate(row: AuditEventRow): AuditEvent {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata) as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  return { ...row, metadata };
}
