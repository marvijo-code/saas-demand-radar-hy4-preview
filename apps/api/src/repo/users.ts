import { get, all, run } from '../db/connection.ts';

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface UserRow {
  id: string;
  workspace_id: string;
  email: string;
  name: string;
  password_hash: string;
  role: 'admin' | 'member';
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  workspace_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  user_agent: string | null;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE email = ?', email.trim().toLowerCase());
}

export function findUserById(id: string): UserRow | undefined {
  return get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}

export function getWorkspace(id: string): WorkspaceRow | undefined {
  return get<WorkspaceRow>('SELECT * FROM workspaces WHERE id = ?', id);
}

export function listMembers(workspaceId: string): (UserRow & { last_seen_at: string | null })[] {
  return all<UserRow & { last_seen_at: string | null }>(
    `SELECT u.*, (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
     FROM users u WHERE u.workspace_id = ? ORDER BY u.role, u.email`,
    workspaceId,
  );
}

export function createSession(session: SessionRow): void {
  run(
    `INSERT INTO sessions (id, user_id, workspace_id, created_at, expires_at, last_seen_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    session.id,
    session.user_id,
    session.workspace_id,
    session.created_at,
    session.expires_at,
    session.last_seen_at,
    session.user_agent,
  );
}

export function findSession(id: string): SessionRow | undefined {
  return get<SessionRow>('SELECT * FROM sessions WHERE id = ?', id);
}

export function touchSession(id: string, at: string): void {
  run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', at, id);
}

export function deleteSession(id: string): void {
  run('DELETE FROM sessions WHERE id = ?', id);
}

export function deleteExpiredSessions(nowIso: string): number {
  return run('DELETE FROM sessions WHERE expires_at <= ?', nowIso).changes;
}

export function updateWorkspaceName(workspaceId: string, name: string): void {
  run('UPDATE workspaces SET name = ? WHERE id = ?', name, workspaceId);
}

export function createUser(input: {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: 'admin' | 'member';
}): void {
  run(
    `INSERT INTO users (id, workspace_id, email, name, password_hash, role, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    input.id,
    input.workspaceId,
    input.email.toLowerCase(),
    input.name,
    input.passwordHash,
    input.role,
    new Date().toISOString(),
  );
}

export function updateUserRole(workspaceId: string, userId: string, role: 'admin' | 'member'): number {
  return run('UPDATE users SET role = ? WHERE id = ? AND workspace_id = ?', role, userId, workspaceId)
    .changes;
}

export function deleteUser(workspaceId: string, userId: string): number {
  return run('DELETE FROM users WHERE id = ? AND workspace_id = ?', userId, workspaceId).changes;
}

export function countAdmins(workspaceId: string): number {
  const row = get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM users WHERE workspace_id = ? AND role = 'admin'",
    workspaceId,
  );
  return row?.count ?? 0;
}

export function countWorkspaceMembers(workspaceId: string): number {
  const row = get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM users WHERE workspace_id = ?',
    workspaceId,
  );
  return row?.count ?? 0;
}
