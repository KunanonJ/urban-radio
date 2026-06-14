-- Phase 1: Radio data foundations
-- Adds multi-station tenancy, voice tracking, hourly clocks, cue points, and royalty-log tables.
-- Parallel to existing catalog tables (tracks, albums, artists, playlists) — no existing tables touched.
-- All IDs are TEXT (UUIDs generated at application layer). All timestamps are TEXT (ISO 8601 / datetime()).

-- ---------------------------------------------------------------------------
-- Organizations (billing / tenancy root)
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  plan                 TEXT NOT NULL DEFAULT 'free',
  billing_customer_id  TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Stations (one org may own many stations)
-- ---------------------------------------------------------------------------
CREATE TABLE stations (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  timezone   TEXT NOT NULL DEFAULT 'UTC',
  stream_url TEXT,
  language   TEXT DEFAULT 'en',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, slug)
);

CREATE INDEX idx_stations_org ON stations(org_id);

-- ---------------------------------------------------------------------------
-- Station members (RBAC join table)
-- ---------------------------------------------------------------------------
CREATE TABLE station_members (
  station_id TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('operator','producer','programmer','admin','guest_vt')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (station_id, user_id)
);

CREATE INDEX idx_station_members_user ON station_members(user_id);

-- ---------------------------------------------------------------------------
-- Categories (file-type system: music | sweeper | liner | id | promo | jingle | bed | vt | spot)
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id                        TEXT PRIMARY KEY,
  station_id                TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,
  color                     TEXT DEFAULT '#888888',
  repeat_protection_minutes INTEGER DEFAULT 0,
  level_db                  REAL DEFAULT 0,
  suppress_title            INTEGER DEFAULT 0,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(station_id, name)
);

CREATE INDEX idx_categories_station ON categories(station_id);

-- ---------------------------------------------------------------------------
-- Radio tracks (station-scoped; parallel to existing `tracks` for back-compat)
-- ---------------------------------------------------------------------------
CREATE TABLE radio_tracks (
  id              TEXT PRIMARY KEY,
  station_id      TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  category_id     TEXT REFERENCES categories(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  artist          TEXT,
  album           TEXT,
  genre           TEXT,
  bpm             REAL,
  music_key       TEXT,
  energy          INTEGER,
  era_year        INTEGER,
  language        TEXT,
  duration_ms     INTEGER NOT NULL,
  cue_in_ms       INTEGER DEFAULT 0,
  cue_out_ms      INTEGER,
  intro_ms        INTEGER,
  outro_ms        INTEGER,
  mix_point_ms    INTEGER,
  loudness_lufs   REAL,
  file_type       TEXT,
  content_hash    TEXT,
  storage_key     TEXT NOT NULL,
  custom_f1       TEXT,
  custom_f2       TEXT,
  custom_f3       TEXT,
  custom_f4       TEXT,
  custom_f5       TEXT,
  rating          INTEGER,
  play_count      INTEGER DEFAULT 0,
  last_played_at  TEXT,
  date_added      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_radio_tracks_station ON radio_tracks(station_id);
CREATE INDEX idx_radio_tracks_category ON radio_tracks(category_id);
CREATE INDEX idx_radio_tracks_content_hash ON radio_tracks(station_id, content_hash);

-- ---------------------------------------------------------------------------
-- Hourly programming clocks
-- ---------------------------------------------------------------------------
CREATE TABLE clocks (
  id                  TEXT PRIMARY KEY,
  station_id          TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  color               TEXT DEFAULT '#3b82f6',
  target_duration_ms  INTEGER DEFAULT 3600000,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clocks_station ON clocks(station_id);

-- Clock slots (ordered items inside a clock)
CREATE TABLE clock_slots (
  id                   TEXT PRIMARY KEY,
  clock_id             TEXT NOT NULL REFERENCES clocks(id) ON DELETE CASCADE,
  position             INTEGER NOT NULL,
  slot_type            TEXT NOT NULL CHECK (slot_type IN ('music','sweeper','liner','vt','id','news','weather','spot','bed','custom')),
  category_id          TEXT REFERENCES categories(id) ON DELETE SET NULL,
  duration_estimate_ms INTEGER NOT NULL,
  rules_json           TEXT,
  UNIQUE(clock_id, position)
);

CREATE INDEX idx_clock_slots_clock ON clock_slots(clock_id);
CREATE INDEX idx_clock_slots_category ON clock_slots(category_id);

-- ---------------------------------------------------------------------------
-- Weekly schedule grid (clock -> weekday + hour assignment)
-- ---------------------------------------------------------------------------
CREATE TABLE schedule_assignments (
  id          TEXT PRIMARY KEY,
  station_id  TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  clock_id    TEXT NOT NULL REFERENCES clocks(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  hour        INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  valid_from  TEXT,
  valid_until TEXT,
  rrule       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_schedule_station_weekday_hour ON schedule_assignments(station_id, weekday, hour);
CREATE INDEX idx_schedule_clock ON schedule_assignments(clock_id);

-- ---------------------------------------------------------------------------
-- Play log (royalty reporting + analytics backbone)
-- ---------------------------------------------------------------------------
CREATE TABLE play_log (
  id                 TEXT PRIMARY KEY,
  station_id         TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  track_id           TEXT,
  title_snapshot     TEXT NOT NULL,
  artist_snapshot    TEXT,
  played_at          TEXT NOT NULL,
  duration_played_ms INTEGER,
  source             TEXT NOT NULL CHECK (source IN ('automation','manual','live_dj','voice_track','cart','spot')),
  isrc               TEXT,
  iswc               TEXT
);

CREATE INDEX idx_play_log_station_played_at ON play_log(station_id, played_at);
CREATE INDEX idx_play_log_track ON play_log(track_id);

-- ---------------------------------------------------------------------------
-- Voice tracks
-- ---------------------------------------------------------------------------
CREATE TABLE voice_tracks (
  id                  TEXT PRIMARY KEY,
  station_id          TEXT NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  recorded_by         TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  storage_key         TEXT NOT NULL,
  duration_ms         INTEGER NOT NULL,
  transcript          TEXT,
  target_clock_slot_id TEXT REFERENCES clock_slots(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','aired','archived')),
  ai_generated        INTEGER DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_voice_tracks_station ON voice_tracks(station_id);
CREATE INDEX idx_voice_tracks_recorded_by ON voice_tracks(recorded_by);
CREATE INDEX idx_voice_tracks_target_slot ON voice_tracks(target_clock_slot_id);

-- ---------------------------------------------------------------------------
-- Audit log (compliance / change trail)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id             TEXT PRIMARY KEY,
  station_id     TEXT REFERENCES stations(id) ON DELETE CASCADE,
  actor_user_id  TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  before_json    TEXT,
  after_json     TEXT,
  at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_station_at ON audit_log(station_id, at);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id);
