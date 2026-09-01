-- 005_audit_nullable_workspace.sql — allows audit rows that belong to no workspace.
--
-- A failed sign-in for an unknown email address has no tenant to attach to. Recording it
-- against a placeholder id violated the workspaces foreign key, so `workspace_id` becomes
-- nullable. SQLite cannot alter NOT NULL, so the table is rebuilt in place.

CREATE TABLE audit_events_rebuilt (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id    TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email     TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT NOT NULL,
  target_id       TEXT,
  summary         TEXT NOT NULL,
  metadata        TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL
);

INSERT INTO audit_events_rebuilt
  (id, workspace_id, actor_user_id, actor_email, action, target_type, target_id, summary, metadata, created_at)
SELECT
  id, workspace_id, actor_user_id, actor_email, action, target_type, target_id, summary, metadata, created_at
FROM audit_events;

DROP TABLE audit_events;

ALTER TABLE audit_events_rebuilt RENAME TO audit_events;

CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_events(workspace_id, created_at DESC);
