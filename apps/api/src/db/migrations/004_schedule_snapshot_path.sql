-- 004_schedule_snapshot_path.sql — lets a workspace pin the snapshot file used by the
-- scheduled snapshot adapter instead of relying on the process level default.

ALTER TABLE schedule_settings ADD COLUMN snapshot_path TEXT;
