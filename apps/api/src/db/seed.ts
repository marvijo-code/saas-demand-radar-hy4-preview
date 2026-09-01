import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { closeDb, getDb, transaction } from './connection.ts';
import { hashPassword } from '../auth/passwords.ts';
import { migrate } from './migrate.ts';

export interface SeedUser {
  email: string;
  password: string;
  name: string;
  workspaceId: string;
  role: 'admin' | 'member';
}

/**
 * Deterministic local accounts required by the interoperability contract.
 * Passwords are only ever stored as scrypt hashes.
 */
export const SEED_USERS: SeedUser[] = [
  {
    email: 'admin@acme.test',
    password: 'AcmeAdmin!2026',
    name: 'Ada Admin',
    workspaceId: 'ws_acme',
    role: 'admin',
  },
  {
    email: 'member@acme.test',
    password: 'AcmeMember!2026',
    name: 'Mia Member',
    workspaceId: 'ws_acme',
    role: 'member',
  },
  {
    email: 'admin@beta.test',
    password: 'BetaAdmin!2026',
    name: 'Bo Admin',
    workspaceId: 'ws_beta',
    role: 'admin',
  },
];

interface SeedResult {
  workspaces: string[];
  users: { email: string; workspaceId: string; role: string }[];
}

export function seedUsers(): SeedResult {
  migrate();
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)`,
  ).run('ws_acme', 'Acme Growth', 'acme', now);
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)`,
  ).run('ws_beta', 'Beta Labs', 'beta', now);

  transaction(() => {
    for (const user of SEED_USERS) {
      const existing = db
        .prepare('SELECT id FROM users WHERE email = ?')
        .get(user.email) as { id: string } | undefined;
      const passwordHash = hashPassword(user.password);
      if (existing) {
        db.prepare(
          `UPDATE users SET name = ?, workspace_id = ?, role = ?, password_hash = ? WHERE id = ?`,
        ).run(user.name, user.workspaceId, user.role, passwordHash, existing.id);
      } else {
        db.prepare(
          `INSERT INTO users (id, workspace_id, email, name, password_hash, role, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          `usr_${user.email.replace(/[^a-z0-9]/gi, '').toLowerCase()}`,
          user.workspaceId,
          user.email,
          user.name,
          passwordHash,
          user.role,
          now,
        );
      }
    }
  });

  const workspaces = db
    .prepare('SELECT name FROM workspaces ORDER BY name')
    .all()
    .map((row) => (row as { name: string }).name);
  const users = db
    .prepare('SELECT email, workspace_id, role FROM users ORDER BY email')
    .all()
    .map((row) => {
      const record = row as { email: string; workspace_id: string; role: string };
      return { email: record.email, workspaceId: record.workspace_id, role: record.role };
    });
  return { workspaces, users };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const result = seedUsers();
  console.log(JSON.stringify(result, null, 2));
  closeDb();
}

export const ensureDataDir = (file: string) => mkdirSync(dirname(file), { recursive: true });
