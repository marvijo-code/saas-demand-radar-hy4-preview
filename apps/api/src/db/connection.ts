import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function resolveDbPath(explicit?: string): string {
  const configured =
    explicit ??
    process.env.SDR_DATABASE_PATH ??
    process.env.DATABASE_PATH ??
    resolve(here, '../../../../data/signal-radar.sqlite');
  return resolve(configured);
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const path = resolveDbPath();
  mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  connection.exec('PRAGMA journal_mode = WAL;');
  connection.exec('PRAGMA foreign_keys = ON;');
  connection.exec('PRAGMA busy_timeout = 5000;');
  connection.exec('PRAGMA synchronous = NORMAL;');
  db = connection;
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function all<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T[] {
  return getDb().prepare(sql).all(...(params as never[])) as T[];
}

export function get<T = Record<string, unknown>>(
  sql: string,
  ...params: SqlParam[]
): T | undefined {
  return getDb().prepare(sql).get(...(params as never[])) as T | undefined;
}

export function run(sql: string, ...params: SqlParam[]): { changes: number; lastInsertRowid: number | bigint } {
  const result = getDb().prepare(sql).run(...(params as never[]));
  return {
    changes: Number(result.changes),
    lastInsertRowid: result.lastInsertRowid,
  };
}

export type SqlParam = string | number | bigint | Buffer | null;

export function transaction<T>(fn: () => T): T {
  const connection = getDb();
  connection.exec('BEGIN');
  try {
    const result = fn();
    connection.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      connection.exec('ROLLBACK');
    } catch {
      /* ignore rollback errors, the original error is more useful */
    }
    throw error;
  }
}
