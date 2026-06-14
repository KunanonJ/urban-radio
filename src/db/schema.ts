/**
 * Drizzle Postgres schema — Sonic Bloom catalog + radio platform.
 *
 * This file is the Postgres mirror of the canonical D1 SQLite schema defined in
 * `migrations/0001_init.sql` … `migrations/0008_presence.sql`.
 *
 * Strangler-fig migration rules (Wave RM-α):
 *   - D1 migrations REMAIN canonical for Cloudflare Pages until cutover (Wave δ).
 *   - This Drizzle schema is additive — no existing D1 migration is touched.
 *   - Once Railway runs production traffic and Cloudflare is archived,
 *     `src/db/schema.ts` becomes the single source of truth and `migrations/`
 *     can be frozen as a historical artefact.
 *
 * Translation conventions (D1 → Postgres):
 *   - `TEXT PRIMARY KEY` (UUIDs we generate in TS) → `text('id').primaryKey()`.
 *     We DO NOT use the `uuid` Postgres type because existing app code passes
 *     opaque strings (incl. `user-demo`, `org-demo`) that aren't valid UUIDs.
 *   - `TEXT NOT NULL DEFAULT (datetime('now'))` → `text(...).notNull().default(sql`(now() at time zone 'utc')::text`)`.
 *     We KEEP these as `text` rather than `timestamp` because keyset cursors in
 *     `functions/_lib/audit-log-queries.ts`, `play-log-queries.ts`, and other
 *     query builders compare these columns as ISO strings: `(at, id) < (?, ?)`.
 *     Switching to native `timestamp` would silently break that contract.
 *     We may revisit and move to `timestamptz` post-cutover; for the mirror it
 *     stays string-shaped.
 *   - `INTEGER` storing 0/1 booleans (`is_public`, `suppress_title`, `ai_generated`)
 *     → kept as `integer` for binary compatibility with existing client code that
 *     reads/writes 0 and 1. Switching to Postgres `boolean` would force a code
 *     change in every caller.
 *   - `REAL` (floating point) → `real` (Postgres single-precision float, matches D1's `REAL`).
 *   - `CHECK (col IN (…))` → Drizzle `check('name', sql`col IN (…)`)` in the table config.
 *   - D1 `UNIQUE(a, b)` composite → Drizzle `unique('idx_name').on(table.a, table.b)`.
 *   - D1 `FOREIGN KEY … ON DELETE CASCADE/SET NULL` → Drizzle
 *     `.references(() => other.id, { onDelete: 'cascade' | 'set null' })`.
 *   - D1 `audit_log.before_json / after_json` (TEXT) stays as `text` — the audit
 *     helper in `functions/_lib/audit-log.ts` JSON-stringifies before binding, so
 *     the contract is string-in / string-out. `jsonb` is a separate optimisation.
 *
 * Exports are grouped at the bottom of each domain section. Type aliases use
 * Drizzle's `$inferSelect` / `$inferInsert` so callers can `import type { RadioTrack } from '@/db/schema'`.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  text,
  unique,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Shared default: ISO-string `now()` for timestamps stored as text.
// ---------------------------------------------------------------------------
const nowText = sql`(now() at time zone 'utc')::text`;

// ===========================================================================
// AUTH (migration 0003)
// ===========================================================================

export const authUsers = pgTable(
  'auth_users',
  {
    id: text('id').primaryKey().notNull(),
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    createdAt: text('created_at').notNull().default(nowText),
  },
);

export type AuthUser = typeof authUsers.$inferSelect;
export type NewAuthUser = typeof authUsers.$inferInsert;

// ===========================================================================
// CATALOG (migration 0001 — legacy demo catalog, kept for back-compat)
// ===========================================================================

export const artists = pgTable('artists', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  artwork: text('artwork').notNull(),
  genresJson: text('genres_json').notNull().default('[]'),
});

export const albums = pgTable('albums', {
  id: text('id').primaryKey().notNull(),
  title: text('title').notNull(),
  artistId: text('artist_id')
    .notNull()
    .references(() => artists.id),
  artwork: text('artwork').notNull(),
  year: integer('year').notNull(),
  genre: text('genre').notNull(),
  source: text('source').notNull(),
  dateAdded: text('date_added'),
});

export const tracks = pgTable(
  'tracks',
  {
    id: text('id').primaryKey().notNull(),
    title: text('title').notNull(),
    artistId: text('artist_id')
      .notNull()
      .references(() => artists.id),
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id),
    duration: integer('duration').notNull(),
    artwork: text('artwork').notNull(),
    source: text('source').notNull(),
    genre: text('genre').notNull(),
    year: integer('year').notNull(),
    trackNumber: integer('track_number').notNull().default(1),
    dateAdded: text('date_added'),
    mediaR2Key: text('media_r2_key'),
    contentHash: text('content_hash'),
  },
  (t) => [
    index('idx_tracks_album').on(t.albumId),
    index('idx_tracks_artist').on(t.artistId),
  ],
);

export const playlists = pgTable('playlists', {
  id: text('id').primaryKey().notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  artwork: text('artwork').notNull(),
  createdBy: text('created_by').notNull().default('You'),
  isPublic: integer('is_public').notNull().default(0),
});

export const playlistTracks = pgTable(
  'playlist_tracks',
  {
    playlistId: text('playlist_id')
      .notNull()
      .references(() => playlists.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.playlistId, t.trackId] }),
    index('idx_playlist_tracks_pl').on(t.playlistId),
  ],
);

export const mediaObjects = pgTable('media_objects', {
  id: text('id').primaryKey().notNull(),
  r2Key: text('r2_key').notNull().unique(),
  trackId: text('track_id').references(() => tracks.id, { onDelete: 'set null' }),
  bytes: integer('bytes').notNull(),
  contentType: text('content_type'),
  contentHash: text('content_hash'),
  createdAt: text('created_at').notNull(),
});

export type Artist = typeof artists.$inferSelect;
export type NewArtist = typeof artists.$inferInsert;
export type Album = typeof albums.$inferSelect;
export type NewAlbum = typeof albums.$inferInsert;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type Playlist = typeof playlists.$inferSelect;
export type NewPlaylist = typeof playlists.$inferInsert;
export type PlaylistTrack = typeof playlistTracks.$inferSelect;
export type NewPlaylistTrack = typeof playlistTracks.$inferInsert;
export type MediaObject = typeof mediaObjects.$inferSelect;
export type NewMediaObject = typeof mediaObjects.$inferInsert;

// ===========================================================================
// RADIO PLATFORM — TENANCY (migration 0004)
// ===========================================================================

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey().notNull(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('free'),
  billingCustomerId: text('billing_customer_id'),
  createdAt: text('created_at').notNull().default(nowText),
});

export const stations = pgTable(
  'stations',
  {
    id: text('id').primaryKey().notNull(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    streamUrl: text('stream_url'),
    language: text('language').default('en'),
    createdAt: text('created_at').notNull().default(nowText),
  },
  (t) => [
    unique('stations_org_id_slug_key').on(t.orgId, t.slug),
    index('idx_stations_org').on(t.orgId),
  ],
);

export const stationMembers = pgTable(
  'station_members',
  {
    stationId: text('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: text('created_at').notNull().default(nowText),
  },
  (t) => [
    primaryKey({ columns: [t.stationId, t.userId] }),
    check(
      'station_members_role_check',
      sql`${t.role} IN ('operator','producer','programmer','admin','guest_vt')`,
    ),
    index('idx_station_members_user').on(t.userId),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Station = typeof stations.$inferSelect;
export type NewStation = typeof stations.$inferInsert;
export type StationMember = typeof stationMembers.$inferSelect;
export type NewStationMember = typeof stationMembers.$inferInsert;

// ===========================================================================
// RADIO PLATFORM — CONTENT (migration 0004)
// ===========================================================================

export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey().notNull(),
    stationId: text('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').default('#888888'),
    repeatProtectionMinutes: integer('repeat_protection_minutes').default(0),
    levelDb: real('level_db').default(0),
    // INTEGER 0/1 boolean — kept as integer to preserve D1 binary compat.
    suppressTitle: integer('suppress_title').default(0),
    createdAt: text('created_at').notNull().default(nowText),
  },
  (t) => [
    unique('categories_station_id_name_key').on(t.stationId, t.name),
    index('idx_categories_station').on(t.stationId),
  ],
);

export const radioTracks = pgTable(
  'radio_tracks',
  {
    id: text('id').primaryKey().notNull(),
    stationId: text('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    artist: text('artist'),
    album: text('album'),
    genre: text('genre'),
    bpm: real('bpm'),
    musicKey: text('music_key'),
    energy: integer('energy'),
    eraYear: integer('era_year'),
    language: text('language'),
    durationMs: integer('duration_ms').notNull(),
    cueInMs: integer('cue_in_ms').default(0),
    cueOutMs: integer('cue_out_ms'),
    introMs: integer('intro_ms'),
    outroMs: integer('outro_ms'),
    mixPointMs: integer('mix_point_ms'),
    loudnessLufs: real('loudness_lufs'),
    fileType: text('file_type'),
    contentHash: text('content_hash'),
    storageKey: text('storage_key').notNull(),
    customF1: text('custom_f1'),
    customF2: text('custom_f2'),
    customF3: text('custom_f3'),
    customF4: text('custom_f4'),
    customF5: text('custom_f5'),
    rating: integer('rating'),
    playCount: integer('play_count').default(0),
    lastPlayedAt: text('last_played_at'),
    dateAdded: text('date_added').notNull().default(nowText),
  },
  (t) => [
    index('idx_radio_tracks_station').on(t.stationId),
    index('idx_radio_tracks_category').on(t.categoryId),
    // Pentest M-06: UNIQUE (station_id, content_hash) closes the TOCTOU
    // dedup race in /api/upload. Without this constraint, two concurrent
    // uploads of the same audio both pass the SELECT-then-INSERT check
    // and create duplicate rows pointing at the same R2 object. The
    // unique index makes the second INSERT fail; the upload handler
    // catches it and returns the existing row's id.
    //
    // Postgres treats multiple NULL content_hash values as DISTINCT, so
    // legacy rows uploaded without a hash continue to coexist.
    unique('uq_radio_tracks_station_content_hash').on(
      t.stationId,
      t.contentHash,
    ),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type RadioTrack = typeof radioTracks.$inferSelect;
export type NewRadioTrack = typeof radioTracks.$inferInsert;

// ===========================================================================
// RADIO PLATFORM — SCHEDULING (migration 0004)
// ===========================================================================

export const clocks = pgTable(
  'clocks',
  {
    id: text('id').primaryKey().notNull(),
    stationId: text('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').default('#3b82f6'),
    targetDurationMs: integer('target_duration_ms').default(3_600_000),
    createdAt: text('created_at').notNull().default(nowText),
  },
  (t) => [index('idx_clocks_station').on(t.stationId)],
);

export const clockSlots = pgTable(
  'clock_slots',
  {
    id: text('id').primaryKey().notNull(),
    clockId: text('clock_id')
      .notNull()
      .references(() => clocks.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    slotType: text('slot_type').notNull(),
    categoryId: text('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    durationEstimateMs: integer('duration_estimate_ms').notNull(),
    rulesJson: text('rules_json'),
  },
  (t) => [
    unique('clock_slots_clock_id_position_key').on(t.clockId, t.position),
    check(
      'clock_slots_slot_type_check',
      sql`${t.slotType} IN ('music','sweeper','liner','vt','id','news','weather','spot','bed','custom')`,
    ),
    index('idx_clock_slots_clock').on(t.clockId),
    index('idx_clock_slots_category').on(t.categoryId),
  ],
);

export const scheduleAssignments = pgTable(
  'schedule_assignments',
  {
    id: text('id').primaryKey().notNull(),
    stationId: text('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    clockId: text('clock_id')
      .notNull()
      .references(() => clocks.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    hour: integer('hour').notNull(),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    rrule: text('rrule'),
    createdAt: text('created_at').notNull().default(nowText),
  },
  (t) => [
    check(
      'schedule_assignments_weekday_check',
      sql`${t.weekday} BETWEEN 0 AND 6`,
    ),
    check('schedule_assignments_hour_check', sql`${t.hour} BETWEEN 0 AND 23`),
    index('idx_schedule_station_weekday_hour').on(
      t.stationId,
      t.weekday,
      t.hour,
    ),
    index('idx_schedule_clock').on(t.clockId),
  ],
);

export type Clock = typeof clocks.$inferSelect;
export type NewClock = typeof clocks.$inferInsert;
export type ClockSlot = typeof clockSlots.$inferSelect;
export type NewClockSlot = typeof clockSlots.$inferInsert;
export type ScheduleAssignment = typeof scheduleAssignments.$inferSelect;
export type NewScheduleAssignment = typeof scheduleAssignments.$inferInsert;

// ===========================================================================
// RADIO PLATFORM — TELEMETRY (migrations 0004 + 0006)
// ===========================================================================

// `source` CHECK is the union from 0004 EXTENDED with the values added in 0006:
//   automation | manual | live_dj | voice_track | cart | spot | now_playing | auto_recognition
export const playLog = pgTable(
  'play_log',
  {
    id: text('id').primaryKey().notNull(),
    stationId: text('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    trackId: text('track_id'),
    titleSnapshot: text('title_snapshot').notNull(),
    artistSnapshot: text('artist_snapshot'),
    playedAt: text('played_at').notNull(),
    durationPlayedMs: integer('duration_played_ms'),
    source: text('source').notNull(),
    isrc: text('isrc'),
    iswc: text('iswc'),
  },
  (t) => [
    check(
      'play_log_source_check',
      sql`${t.source} IN ('automation','manual','live_dj','voice_track','cart','spot','now_playing','auto_recognition')`,
    ),
    index('idx_play_log_station_played_at').on(t.stationId, t.playedAt),
    index('idx_play_log_track').on(t.trackId),
  ],
);

export const voiceTracks = pgTable(
  'voice_tracks',
  {
    id: text('id').primaryKey().notNull(),
    stationId: text('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    recordedBy: text('recorded_by').references(() => authUsers.id, {
      onDelete: 'set null',
    }),
    storageKey: text('storage_key').notNull(),
    durationMs: integer('duration_ms').notNull(),
    transcript: text('transcript'),
    targetClockSlotId: text('target_clock_slot_id').references(
      () => clockSlots.id,
      { onDelete: 'set null' },
    ),
    status: text('status').notNull().default('draft'),
    // INTEGER 0/1 boolean — kept as integer to preserve D1 binary compat.
    aiGenerated: integer('ai_generated').default(0),
    createdAt: text('created_at').notNull().default(nowText),
  },
  (t) => [
    check(
      'voice_tracks_status_check',
      sql`${t.status} IN ('draft','ready','aired','archived')`,
    ),
    index('idx_voice_tracks_station').on(t.stationId),
    index('idx_voice_tracks_recorded_by').on(t.recordedBy),
    index('idx_voice_tracks_target_slot').on(t.targetClockSlotId),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey().notNull(),
    stationId: text('station_id').references(() => stations.id, {
      onDelete: 'cascade',
    }),
    actorUserId: text('actor_user_id').references(() => authUsers.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    // JSON snapshots kept as text — `writeAuditLog` JSON.stringify's at the call site.
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    at: text('at').notNull().default(nowText),
  },
  (t) => [
    index('idx_audit_station_at').on(t.stationId, t.at),
    index('idx_audit_actor').on(t.actorUserId),
  ],
);

export type PlayLog = typeof playLog.$inferSelect;
export type NewPlayLog = typeof playLog.$inferInsert;
export type VoiceTrack = typeof voiceTracks.$inferSelect;
export type NewVoiceTrack = typeof voiceTracks.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type NewAuditLog = typeof auditLog.$inferInsert;

// ===========================================================================
// AI USAGE (migration 0006)
// ===========================================================================

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: text('id').primaryKey().notNull(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    stationId: text('station_id').references(() => stations.id, {
      onDelete: 'set null',
    }),
    actorUserId: text('actor_user_id').references(() => authUsers.id, {
      onDelete: 'set null',
    }),
    capability: text('capability').notNull(),
    provider: text('provider').notNull(),
    unit: text('unit').notNull(),
    count: integer('count').notNull(),
    estimatedCostUsd: real('estimated_cost_usd').notNull(),
    requestSummary: text('request_summary'),
    at: text('at').notNull().default(nowText),
  },
  (t) => [
    check(
      'ai_usage_capability_check',
      sql`${t.capability} IN ('voice','text','transcribe','anr')`,
    ),
    check(
      'ai_usage_unit_check',
      sql`${t.unit} IN ('tokens','characters','seconds','requests')`,
    ),
    index('idx_ai_usage_org_at').on(t.orgId, t.at),
    index('idx_ai_usage_station_at').on(t.stationId, t.at),
  ],
);

export type AiUsage = typeof aiUsage.$inferSelect;
export type NewAiUsage = typeof aiUsage.$inferInsert;

// ===========================================================================
// COMMENTS (migration 0007)
// ===========================================================================

export const comments = pgTable(
  'comments',
  {
    id: text('id').primaryKey().notNull(),
    stationId: text('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    authorUserId: text('author_user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    body: text('body').notNull(),
    resolvedAt: text('resolved_at'),
    resolvedByUserId: text('resolved_by_user_id').references(
      () => authUsers.id,
      { onDelete: 'set null' },
    ),
    createdAt: text('created_at').notNull().default(nowText),
    updatedAt: text('updated_at').notNull().default(nowText),
  },
  (t) => [
    check(
      'comments_target_type_check',
      sql`${t.targetType} IN ('clock','clock_slot','schedule_assignment','voice_track','radio_track')`,
    ),
    // Composite index matching D1's idx_comments_target — created_at DESC for
    // newest-first paging. Drizzle 0.45 supports `.desc()` per-column.
    index('idx_comments_target').on(
      t.stationId,
      t.targetType,
      t.targetId,
      t.createdAt.desc(),
    ),
    index('idx_comments_author').on(t.authorUserId),
  ],
);

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

// ===========================================================================
// PRESENCE (migration 0008)
// ===========================================================================

export const presenceSessions = pgTable(
  'presence_sessions',
  {
    id: text('id').primaryKey().notNull(),
    stationId: text('station_id')
      .notNull()
      .references(() => stations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    lastHeartbeatAt: text('last_heartbeat_at').notNull().default(nowText),
    createdAt: text('created_at').notNull().default(nowText),
  },
  (t) => [
    check(
      'presence_sessions_target_type_check',
      sql`${t.targetType} IN ('clock','clock_slot','schedule_assignment','voice_track','radio_track','schedule_cell')`,
    ),
    unique('idx_presence_user_target').on(
      t.stationId,
      t.userId,
      t.targetType,
      t.targetId,
    ),
    index('idx_presence_target').on(
      t.stationId,
      t.targetType,
      t.targetId,
      t.lastHeartbeatAt,
    ),
  ],
);

export type PresenceSession = typeof presenceSessions.$inferSelect;
export type NewPresenceSession = typeof presenceSessions.$inferInsert;

// ===========================================================================
// PROCESSED STRIPE EVENTS — Pentest H-10 dedup
// ---------------------------------------------------------------------------
// Stripe signs each webhook payload but does not protect against replay
// within the verifier's ±300 s timestamp window. We INSERT each event ID
// (primary key) the first time we see it; `ON CONFLICT DO NOTHING` makes
// subsequent attempts a no-op, and the handler short-circuits with 200.
// ===========================================================================

export const processedStripeEvents = pgTable('processed_stripe_events', {
  eventId: text('event_id').primaryKey().notNull(),
  type: text('type').notNull(),
  processedAt: text('processed_at').notNull(),
});

export type ProcessedStripeEvent = typeof processedStripeEvents.$inferSelect;
export type NewProcessedStripeEvent = typeof processedStripeEvents.$inferInsert;
