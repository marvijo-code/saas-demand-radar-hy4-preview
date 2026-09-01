-- 002_seed.sql — deterministic local tenants used by the acceptance suite and local development.
-- Users are created by `apps/api/src/db/seed.ts` because password hashes are derived at
-- seed time from a random salt; only the tenants live in SQL so they exist after migrating.

INSERT OR IGNORE INTO workspaces (id, name, slug, created_at)
VALUES
  ('ws_acme', 'Acme Growth', 'acme', '2026-01-01T00:00:00.000Z'),
  ('ws_beta', 'Beta Labs', 'beta', '2026-01-01T00:00:00.000Z');
