-- 001_init.sql — full schema for SaaS Demand Radar.
-- Applied by apps/api/src/db/migrate.ts. Safe to run once per database.

CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_workspace ON users(workspace_id);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Raw public evidence. One row per (workspace, platform, external id): ingestion is idempotent.
CREATE TABLE IF NOT EXISTS source_records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform       TEXT NOT NULL CHECK (platform IN ('x', 'reddit')),
  external_id    TEXT NOT NULL,
  url            TEXT NOT NULL,
  author         TEXT,
  published_at   TEXT NOT NULL,
  text           TEXT NOT NULL,
  engagement     TEXT NOT NULL DEFAULT '{}',
  subreddit      TEXT,
  first_seen_at  TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (workspace_id, platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_source_records_workspace_published
  ON source_records(workspace_id, published_at);

-- Classified demand signal extracted from one source record.
CREATE TABLE IF NOT EXISTS demand_signals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_record_id  INTEGER NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  strength          REAL NOT NULL,
  matched_phrase    TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  UNIQUE (source_record_id, kind, matched_phrase)
);
CREATE INDEX IF NOT EXISTS idx_demand_signals_workspace ON demand_signals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_demand_signals_record ON demand_signals(source_record_id);

-- Grouped SaaS need. `key` is derived from the representative source record.
CREATE TABLE IF NOT EXISTS needs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key            TEXT NOT NULL,
  title          TEXT NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'validated', 'dismissed')),
  first_seen_at  TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (workspace_id, key)
);
CREATE INDEX IF NOT EXISTS idx_needs_workspace ON needs(workspace_id);

CREATE TABLE IF NOT EXISTS need_evidence (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  need_id           INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
  source_record_id  INTEGER NOT NULL REFERENCES source_records(id) ON DELETE CASCADE,
  added_at          TEXT NOT NULL,
  UNIQUE (need_id, source_record_id)
);
CREATE INDEX IF NOT EXISTS idx_need_evidence_need ON need_evidence(need_id);
CREATE INDEX IF NOT EXISTS idx_need_evidence_record ON need_evidence(source_record_id);

-- Score of a need for a given ranking-model version.
CREATE TABLE IF NOT EXISTS need_scores (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  need_id        INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
  model_version  INTEGER NOT NULL DEFAULT 1,
  score          REAL NOT NULL,
  rank           INTEGER,
  breakdown      TEXT NOT NULL DEFAULT '{}',
  computed_at    TEXT NOT NULL,
  UNIQUE (need_id, model_version)
);
CREATE INDEX IF NOT EXISTS idx_need_scores_version ON need_scores(workspace_id, model_version);

-- Reviewer feedback on a need or on a single piece of evidence.
CREATE TABLE IF NOT EXISTS feedback (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type        TEXT NOT NULL CHECK (target_type IN ('need', 'evidence')),
  need_id            INTEGER REFERENCES needs(id) ON DELETE CASCADE,
  source_record_id   INTEGER REFERENCES source_records(id) ON DELETE CASCADE,
  relevant           INTEGER,
  willingness_to_pay INTEGER NOT NULL DEFAULT 0,
  contacted          INTEGER NOT NULL DEFAULT 0,
  note               TEXT,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_workspace ON feedback(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_need ON feedback(need_id);
CREATE INDEX IF NOT EXISTS idx_feedback_record ON feedback(source_record_id);

-- Versioned ranking model. Every re-score inserts a new row.
CREATE TABLE IF NOT EXISTS ranking_models (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  weights         TEXT NOT NULL,
  phrase_weights  TEXT NOT NULL DEFAULT '{}',
  source_weights  TEXT NOT NULL DEFAULT '{}',
  change_summary  TEXT NOT NULL DEFAULT '[]',
  feedback_ids    TEXT NOT NULL DEFAULT '[]',
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL,
  UNIQUE (workspace_id, version)
);

-- Aggregated phrase weights learned from feedback (1.0 = neutral).
CREATE TABLE IF NOT EXISTS phrase_weights (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  phrase        TEXT NOT NULL,
  weight        REAL NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (workspace_id, phrase)
);

-- Aggregated per-platform weights learned from feedback (1.0 = neutral).
CREATE TABLE IF NOT EXISTS source_weights (
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,
  weight        REAL NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (workspace_id, platform)
);

-- Ingestion runs.
CREATE TABLE IF NOT EXISTS source_runs (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  adapter           TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
  triggered_by      TEXT REFERENCES users(id),
  started_at        TEXT NOT NULL,
  finished_at       TEXT,
  records_seen      INTEGER NOT NULL DEFAULT 0,
  records_created   INTEGER NOT NULL DEFAULT 0,
  records_updated   INTEGER NOT NULL DEFAULT 0,
  records_failed    INTEGER NOT NULL DEFAULT 0,
  signals_created   INTEGER NOT NULL DEFAULT 0,
  needs_created     INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  params            TEXT NOT NULL DEFAULT '{}',
  UNIQUE (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS idx_source_runs_workspace ON source_runs(workspace_id, started_at DESC);

CREATE TABLE IF NOT EXISTS source_run_errors (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT NOT NULL REFERENCES source_runs(id) ON DELETE CASCADE,
  platform       TEXT,
  external_id    TEXT,
  message        TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_run_errors_run ON source_run_errors(run_id);

CREATE TABLE IF NOT EXISTS schedule_settings (
  workspace_id     TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled          INTEGER NOT NULL DEFAULT 0,
  interval_minutes INTEGER NOT NULL DEFAULT 720,
  adapter          TEXT NOT NULL DEFAULT 'snapshot',
  keywords         TEXT NOT NULL DEFAULT '[]',
  subreddits       TEXT NOT NULL DEFAULT '[]',
  last_run_at      TEXT,
  next_run_at      TEXT,
  last_status      TEXT,
  last_error       TEXT,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email     TEXT,
  action          TEXT NOT NULL,
  target_type     TEXT NOT NULL,
  target_id       TEXT,
  summary         TEXT NOT NULL,
  metadata        TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_events(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
