-- 0008_presence.sql
-- Phase 6.1: Slim collaborative presence (REST polling). Each row marks one
-- user actively viewing one polymorphic target (clock, clock_slot,
-- schedule_assignment, voice_track, radio_track, schedule_cell). Clients
-- heartbeat every ~5s; a session is considered "active" when
-- `last_heartbeat_at > now - 15s`. station_id is always the first scope.
--
-- The UNIQUE (station_id, user_id, target_type, target_id) index lets a
-- single INSERT … ON CONFLICT DO UPDATE upsert a session on every heartbeat
-- without server-side reads.
--
-- Deferred (Phase 6.2): real-time push via WebSocket / Durable Objects,
-- CRDT-backed edit locks / cursor positions, join/leave notifications.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_presence_user_target;
--   DROP INDEX IF EXISTS idx_presence_target;
--   DROP TABLE IF EXISTS presence_sessions;

CREATE TABLE presence_sessions (
  id                 TEXT PRIMARY KEY,
  station_id         TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  target_type        TEXT NOT NULL CHECK (
    target_type IN (
      'clock',
      'clock_slot',
      'schedule_assignment',
      'voice_track',
      'radio_track',
      'schedule_cell'
    )
  ),
  target_id          TEXT NOT NULL,
  last_heartbeat_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_presence_target
  ON presence_sessions(station_id, target_type, target_id, last_heartbeat_at);

CREATE UNIQUE INDEX idx_presence_user_target
  ON presence_sessions(station_id, user_id, target_type, target_id);
