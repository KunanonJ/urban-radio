/**
 * radio-types.ts
 *
 * TypeScript interfaces for every table introduced in migration 0004_radio_schema.sql.
 * Extends (does NOT replace) src/lib/types.ts — the existing Track/Album/Artist/Playlist
 * interfaces are unaffected.
 *
 * Column nullability follows the SQL schema exactly:
 *  - Columns with DEFAULT or nullable SQL columns map to optional (?) TypeScript properties.
 *  - NOT NULL columns without a DEFAULT are required.
 *  - Integer columns used as booleans (suppress_title, ai_generated) are typed as `0 | 1`
 *    to match D1/SQLite's storage of boolean values.
 */

// ---------------------------------------------------------------------------
// String-literal union types (re-exported for consumers)
// ---------------------------------------------------------------------------

/** Roles a user may hold in a station. */
export type Role = 'operator' | 'producer' | 'programmer' | 'admin' | 'guest_vt';

/** Permissible slot types inside a programming clock. */
export type SlotType =
  | 'music'
  | 'sweeper'
  | 'liner'
  | 'vt'
  | 'id'
  | 'news'
  | 'weather'
  | 'spot'
  | 'bed'
  | 'custom';

/** Lifecycle states for a voice track. */
export type VoiceTrackStatus = 'draft' | 'ready' | 'aired' | 'archived';

/** How a play_log entry was triggered. */
export type PlayLogSource = 'automation' | 'manual' | 'live_dj' | 'voice_track' | 'cart' | 'spot';

// ---------------------------------------------------------------------------
// Table row interfaces
// ---------------------------------------------------------------------------

/** Row in the `organizations` table. */
export interface Organization {
  id: string;
  name: string;
  /** Billing plan identifier, e.g. 'free' | 'pro' | 'enterprise'. Default: 'free'. */
  plan: string;
  /** External billing provider customer ID (e.g. Stripe customer ID). Nullable. */
  billing_customer_id: string | null;
  /** ISO 8601 timestamp. */
  created_at: string;
}

/** Row in the `stations` table. */
export interface Station {
  id: string;
  org_id: string;
  /** URL-safe identifier unique within the organization. */
  slug: string;
  name: string;
  /** IANA timezone string, e.g. 'America/Chicago'. Default: 'UTC'. */
  timezone: string;
  /** Live or on-demand stream URL. Nullable. */
  stream_url: string | null;
  /** BCP 47 language tag, e.g. 'en', 'th'. Default: 'en'. */
  language: string | null;
  /** ISO 8601 timestamp. */
  created_at: string;
}

/** Row in the `station_members` join table. */
export interface StationMember {
  station_id: string;
  user_id: string;
  role: Role;
  /** ISO 8601 timestamp. */
  created_at: string;
}

/** Row in the `categories` table. */
export interface Category {
  id: string;
  station_id: string;
  name: string;
  /** CSS hex color, e.g. '#888888'. Default: '#888888'. */
  color: string | null;
  /** Minimum minutes before the same category may repeat. Default: 0. */
  repeat_protection_minutes: number | null;
  /** Target loudness adjustment in dB. Default: 0. */
  level_db: number | null;
  /**
   * When 1, the on-air display suppresses the track title during playback.
   * D1/SQLite stores booleans as INTEGER 0|1.
   */
  suppress_title: 0 | 1 | null;
  /** ISO 8601 timestamp. */
  created_at: string;
}

/** Row in the `radio_tracks` table. */
export interface RadioTrack {
  id: string;
  station_id: string;
  category_id: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  /** Beats per minute. Nullable. */
  bpm: number | null;
  /** Musical key, e.g. 'Am', 'C#'. Nullable. */
  music_key: string | null;
  /** Subjective energy level (application-defined scale). Nullable. */
  energy: number | null;
  /** Original release year for rotation era rules. Nullable. */
  era_year: number | null;
  language: string | null;
  /** Total duration in milliseconds. Required. */
  duration_ms: number;
  /** Cue-in point in milliseconds. Default: 0. */
  cue_in_ms: number | null;
  /** Cue-out point in milliseconds. Nullable (use duration_ms if absent). */
  cue_out_ms: number | null;
  /** Duration of music intro before vocals start, in ms. Nullable. */
  intro_ms: number | null;
  /** Duration of outro (instrumental tail) in ms. Nullable. */
  outro_ms: number | null;
  /** Suggested transition point in ms. Nullable. */
  mix_point_ms: number | null;
  /** Integrated loudness per EBU R128, in LUFS. Nullable. */
  loudness_lufs: number | null;
  /** MIME type or format label, e.g. 'audio/flac'. Nullable. */
  file_type: string | null;
  /** SHA-256 or similar content hash for deduplication. Nullable. */
  content_hash: string | null;
  /** R2 / object-store key. Required. */
  storage_key: string;
  custom_f1: string | null;
  custom_f2: string | null;
  custom_f3: string | null;
  custom_f4: string | null;
  custom_f5: string | null;
  /** User-assigned star rating (application-defined scale). Nullable. */
  rating: number | null;
  /** Total number of times the track has been aired. Default: 0. */
  play_count: number | null;
  /** ISO 8601 timestamp of the most recent airplay. Nullable. */
  last_played_at: string | null;
  /** ISO 8601 timestamp. */
  date_added: string;
}

/** Row in the `clocks` table. */
export interface Clock {
  id: string;
  station_id: string;
  name: string;
  /** CSS hex color used in the scheduler UI. Default: '#3b82f6'. */
  color: string | null;
  /** Ideal total clock duration in milliseconds. Default: 3600000 (1 hour). */
  target_duration_ms: number | null;
  /** ISO 8601 timestamp. */
  created_at: string;
}

/** Row in the `clock_slots` table. */
export interface ClockSlot {
  id: string;
  clock_id: string;
  /** 0-based ordering index within the clock. */
  position: number;
  slot_type: SlotType;
  category_id: string | null;
  /** Expected duration of this slot in milliseconds. */
  duration_estimate_ms: number;
  /** JSON string holding optional slot-level scheduling rules. Nullable. */
  rules_json: string | null;
}

/** Row in the `schedule_assignments` table. */
export interface ScheduleAssignment {
  id: string;
  station_id: string;
  clock_id: string;
  /** 0 = Sunday … 6 = Saturday (ISO-compatible application convention). */
  weekday: number;
  /** 0-23 hour in station local time. */
  hour: number;
  /** ISO 8601 date from which this assignment is active. Nullable (open-ended start). */
  valid_from: string | null;
  /** ISO 8601 date after which this assignment is inactive. Nullable (open-ended end). */
  valid_until: string | null;
  /** RFC 5545 RRULE string for recurring overrides. Nullable. */
  rrule: string | null;
  /** ISO 8601 timestamp. */
  created_at: string;
}

/** Row in the `play_log` table. */
export interface PlayLogEntry {
  id: string;
  station_id: string;
  /** FK to radio_tracks.id; nullable because tracks may be deleted after airing. */
  track_id: string | null;
  /** Snapshot of the title at airtime (preserved even if track is deleted). */
  title_snapshot: string;
  /** Snapshot of the artist name at airtime. Nullable. */
  artist_snapshot: string | null;
  /** ISO 8601 timestamp of when the track started playing. */
  played_at: string;
  /** Actual milliseconds played (may differ from duration_ms if cut short). Nullable. */
  duration_played_ms: number | null;
  source: PlayLogSource;
  /** International Standard Recording Code. Nullable. */
  isrc: string | null;
  /** International Standard Musical Work Code. Nullable. */
  iswc: string | null;
}

/** Row in the `voice_tracks` table. */
export interface VoiceTrack {
  id: string;
  station_id: string;
  /** FK to auth_users.id; nullable if the recording user has been deleted. */
  recorded_by: string | null;
  /** R2 / object-store key for the audio file. */
  storage_key: string;
  duration_ms: number;
  /** Auto-generated or human-edited transcript. Nullable. */
  transcript: string | null;
  /** Clock slot this voice track is destined for. Nullable. */
  target_clock_slot_id: string | null;
  status: VoiceTrackStatus;
  /**
   * 1 if the voice track was generated by AI, 0 if recorded by a human.
   * D1/SQLite stores booleans as INTEGER 0|1.
   */
  ai_generated: 0 | 1 | null;
  /** ISO 8601 timestamp. */
  created_at: string;
}

/** Row in the `audit_log` table. */
export interface AuditLogEntry {
  id: string;
  /** Nullable: some audit entries may be system-level (no station context). */
  station_id: string | null;
  /** Nullable: actor may have been deleted. */
  actor_user_id: string | null;
  /** Verb describing the action, e.g. 'create', 'update', 'delete'. */
  action: string;
  /** Entity type acted upon, e.g. 'radio_track', 'clock', 'station'. */
  target_type: string;
  target_id: string;
  /** JSON snapshot of the record before the change. Nullable for creates. */
  before_json: string | null;
  /** JSON snapshot of the record after the change. Nullable for deletes. */
  after_json: string | null;
  /** ISO 8601 timestamp of when the action occurred. */
  at: string;
}
