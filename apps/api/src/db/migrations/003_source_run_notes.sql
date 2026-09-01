-- 003_source_run_notes.sql — human readable adapter notes attached to an ingestion run.
-- Kept in a separate migration so existing databases pick it up without a reset.

ALTER TABLE source_runs ADD COLUMN notes TEXT NOT NULL DEFAULT '[]';
