-- Sonic Bloom catalog (D1). Wrangler tracks applied migrations separately.

CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  artwork TEXT NOT NULL,
  genres_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS albums (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  artwork TEXT NOT NULL,
  year INTEGER NOT NULL,
  genre TEXT NOT NULL,
  source TEXT NOT NULL,
  date_added TEXT,
  FOREIGN KEY (artist_id) REFERENCES artists(id)
);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  artist_id TEXT NOT NULL,
  album_id TEXT NOT NULL,
  duration INTEGER NOT NULL,
  artwork TEXT NOT NULL,
  source TEXT NOT NULL,
  genre TEXT NOT NULL,
  year INTEGER NOT NULL,
  track_number INTEGER NOT NULL DEFAULT 1,
  date_added TEXT,
  media_r2_key TEXT,
  content_hash TEXT,
  FOREIGN KEY (artist_id) REFERENCES artists(id),
  FOREIGN KEY (album_id) REFERENCES albums(id)
);

CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_id);
CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_id);

CREATE TABLE IF NOT EXISTS playlists (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  artwork TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'You',
  is_public INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL,
  track_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, track_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pl ON playlist_tracks(playlist_id);

CREATE TABLE IF NOT EXISTS media_objects (
  id TEXT PRIMARY KEY NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  track_id TEXT,
  bytes INTEGER NOT NULL,
  content_type TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE SET NULL
);
