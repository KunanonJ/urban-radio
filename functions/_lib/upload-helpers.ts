/// <reference types="@cloudflare/workers-types" />

/**
 * Pure helpers for the upload endpoint. Kept side-effect-free so they can be
 * unit-tested in isolation from the Cloudflare Pages runtime (no R2, no D1).
 *
 * Conventions:
 * - File-type detection is conservative: only recognise well-known naming
 *   patterns (sweeper/jingle/id/spot). Otherwise default to "music" — the
 *   client can PATCH the track later once it has decoded the audio.
 * - Default category mirrors migration 0005's seeded ids
 *   (cat-music, cat-jingle, cat-sweeper, cat-id, cat-spot).
 * - All SQL builders are parameterised; never inline user data.
 */

export type RadioFileType = 'music' | 'jingle' | 'sweeper' | 'id' | 'spot' | 'unknown';

/**
 * Best-effort categorisation of an uploaded file based on the filename hints
 * the user (or the upstream system) provided. The MIME type is accepted for
 * future use, but is currently advisory only — Phase 1 ingest does not parse
 * audio metadata server-side.
 */
export function detectFileType(opts: {
  mime?: string;
  filename: string;
}): RadioFileType {
  const name = opts.filename.toLowerCase();
  // Order matters: "id-" must be checked separately from "spot"/"sweeper" so
  // a filename like "sweeper-id-2024" still maps to sweeper.
  if (/(^|[^a-z])sweeper([^a-z]|$)/i.test(name) || name.includes('sweeper_')) {
    return 'sweeper';
  }
  if (/(^|[^a-z])jingle([^a-z]|$)/i.test(name) || name.includes('jingle_')) {
    return 'jingle';
  }
  if (/(^|[^a-z])spot([^a-z]|$)/i.test(name) || name.includes('spot_')) {
    return 'spot';
  }
  // "id-" prefix or "_id_" infix — narrow to avoid matching "video" / "rapid".
  if (/(^|[^a-z])id[-_]/i.test(name)) {
    return 'id';
  }
  return 'music';
}

/**
 * Map a file_type label to the seeded category id from migration 0005.
 * Unknown labels (including empty / undefined) fall back to cat-music so
 * the radio_tracks insert always satisfies FK constraints.
 */
export function defaultCategoryIdForFileType(fileType: string): string {
  switch (fileType) {
    case 'music':
      return 'cat-music';
    case 'jingle':
      return 'cat-jingle';
    case 'sweeper':
      return 'cat-sweeper';
    case 'id':
      return 'cat-id';
    case 'spot':
      return 'cat-spot';
    default:
      return 'cat-music';
  }
}

/**
 * Strip the final extension from a filename. Returns "(untitled)" for empty
 * input so the resulting radio_tracks.title is never an empty string (the
 * column is NOT NULL).
 */
export function stripExtension(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return '(untitled)';
  const withoutExt = trimmed.replace(/\.[^.]+$/, '');
  return withoutExt || '(untitled)';
}

export interface RadioTrackInsertParams {
  trackId: string;
  stationId: string;
  categoryId: string;
  title: string;
  storageKey: string;
  contentHash: string;
  durationMs: number;
  fileType: string;
}

/**
 * Build the parameterised INSERT for a new radio_tracks row. `date_added`
 * defaults to `datetime('now')` in SQL so the value is set on the DB side.
 */
export function buildRadioTrackInsert(
  p: RadioTrackInsertParams,
): { sql: string; params: unknown[] } {
  const sql = `INSERT INTO radio_tracks
    (id, station_id, category_id, title, storage_key, content_hash, duration_ms, file_type, date_added)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
  const params: unknown[] = [
    p.trackId,
    p.stationId,
    p.categoryId,
    p.title,
    p.storageKey,
    p.contentHash,
    p.durationMs,
    p.fileType,
  ];
  return { sql, params };
}

/**
 * Build the SELECT used to detect duplicate uploads within a station. The
 * combined (station_id, content_hash) is backed by an index — see
 * migration 0004 `idx_radio_tracks_content_hash`.
 */
export function buildDuplicateCheck(
  stationId: string,
  contentHash: string,
): { sql: string; params: unknown[] } {
  const sql = `SELECT id, title, storage_key
    FROM radio_tracks
    WHERE station_id = ? AND content_hash = ?
    LIMIT 1`;
  return { sql, params: [stationId, contentHash] };
}
