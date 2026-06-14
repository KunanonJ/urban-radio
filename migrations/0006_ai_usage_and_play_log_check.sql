-- 0006_ai_usage_and_play_log_check.sql
-- Phase 4-α: AI cost tracking + play_log source expansion.
--
-- Adds the `ai_usage` table (one row per AI capability call) and extends the
-- `play_log.source` CHECK constraint to allow `now_playing` and `auto_recognition`
-- (used by the Live Studio + ANR auto-logger respectively).
--
-- SQLite cannot ALTER an existing CHECK constraint, so the play_log update uses
-- the canonical create-new / copy-rows / drop-old / rename pattern. Existing
-- rows are preserved verbatim.
--
-- Rollback:
--   DROP TABLE ai_usage;
--   -- play_log CHECK rollback: same create+copy+drop+rename pattern but with
--   -- the OLD CHECK list (no 'now_playing', no 'auto_recognition').

-- ---------------------------------------------------------------------------
-- AI usage ledger
-- ---------------------------------------------------------------------------
CREATE TABLE ai_usage (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  station_id         TEXT REFERENCES stations(id) ON DELETE SET NULL,
  actor_user_id      TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  capability         TEXT NOT NULL CHECK (capability IN ('voice','text','transcribe','anr')),
  provider           TEXT NOT NULL,
  unit               TEXT NOT NULL CHECK (unit IN ('tokens','characters','seconds','requests')),
  count              INTEGER NOT NULL,
  estimated_cost_usd REAL NOT NULL,
  request_summary    TEXT,
  at                 TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ai_usage_org_at ON ai_usage(org_id, at);
CREATE INDEX idx_ai_usage_station_at ON ai_usage(station_id, at);

-- ---------------------------------------------------------------------------
-- play_log.source CHECK expansion
-- Add 'now_playing' (Live Studio manual logging) and 'auto_recognition' (ANR auto-logging).
-- ---------------------------------------------------------------------------
CREATE TABLE play_log_new (
  id                 TEXT PRIMARY KEY,
  station_id         TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  track_id           TEXT,
  title_snapshot     TEXT NOT NULL,
  artist_snapshot    TEXT,
  played_at          TEXT NOT NULL,
  duration_played_ms INTEGER,
  source             TEXT NOT NULL CHECK (
    source IN (
      'automation',
      'manual',
      'live_dj',
      'voice_track',
      'cart',
      'spot',
      'now_playing',
      'auto_recognition'
    )
  ),
  isrc               TEXT,
  iswc               TEXT
);

INSERT INTO play_log_new (
  id, station_id, track_id, title_snapshot, artist_snapshot,
  played_at, duration_played_ms, source, isrc, iswc
)
SELECT
  id, station_id, track_id, title_snapshot, artist_snapshot,
  played_at, duration_played_ms, source, isrc, iswc
FROM play_log;

DROP TABLE play_log;
ALTER TABLE play_log_new RENAME TO play_log;

CREATE INDEX idx_play_log_station_played_at ON play_log(station_id, played_at);
CREATE INDEX idx_play_log_track ON play_log(track_id);
