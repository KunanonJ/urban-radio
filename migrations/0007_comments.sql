-- 0007_comments.sql
-- Phase 6: Comment threads anchored to clocks, clock_slots, schedule_assignments,
-- voice_tracks, and radio_tracks. Polymorphic via (target_type, target_id);
-- station_id remains the multi-tenant scope. `resolved_at` is nullable — a
-- non-null value marks the comment as resolved.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_comments_author;
--   DROP INDEX IF EXISTS idx_comments_target;
--   DROP TABLE IF EXISTS comments;

CREATE TABLE comments (
  id                  TEXT PRIMARY KEY,
  station_id          TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  author_user_id      TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  target_type         TEXT NOT NULL CHECK (
    target_type IN ('clock', 'clock_slot', 'schedule_assignment', 'voice_track', 'radio_track')
  ),
  target_id           TEXT NOT NULL,
  body                TEXT NOT NULL,
  resolved_at         TEXT,
  resolved_by_user_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_comments_target ON comments(station_id, target_type, target_id, created_at DESC);
CREATE INDEX idx_comments_author ON comments(author_user_id);
