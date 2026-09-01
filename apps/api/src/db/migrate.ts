import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, transaction } from './connection.ts';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

export function loadMigrations(): MigrationFile[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const version = Number.parseInt(file.slice(0, file.indexOf('_')), 10);
      if (!Number.isFinite(version)) {
        throw new Error(`Migration file ${file} must start with "<number>_"`);
      }
      return {
        version,
        name: file,
        sql: readFileSync(join(migrationsDir, file), 'utf8'),
      };
    });
}

export function appliedVersions(): number[] {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  return getDb()
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => Number((row as { version: number }).version));
}

export function migrate(): string[] {
  const applied = new Set(appliedVersions());
  const executed: string[] = [];
  for (const migration of loadMigrations()) {
    if (applied.has(migration.version)) continue;
    transaction(() => {
      getDb().exec(migration.sql);
      getDb()
        .prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        )
        .run(migration.version, migration.name, new Date().toISOString());
    });
    executed.push(migration.name);
  }
  return executed;
}

export function reset(): void {
  getDb().exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE IF EXISTS audit_events;
    DROP TABLE IF EXISTS schedule_settings;
    DROP TABLE IF EXISTS source_run_errors;
    DROP TABLE IF EXISTS source_runs;
    DROP TABLE IF EXISTS source_weights;
    DROP TABLE IF EXISTS phrase_weights;
    DROP TABLE IF EXISTS ranking_models;
    DROP TABLE IF EXISTS feedback;
    DROP TABLE IF EXISTS need_scores;
    DROP TABLE IF EXISTS need_evidence;
    DROP TABLE IF EXISTS needs;
    DROP TABLE IF EXISTS demand_signals;
    DROP TABLE IF EXISTS source_records;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS workspaces;
    DROP TABLE IF EXISTS schema_migrations;
    PRAGMA foreign_keys = ON;
  `);
}

export const migrationsPath = resolve(migrationsDir);
