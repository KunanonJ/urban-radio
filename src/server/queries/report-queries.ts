/**
 * Pure Drizzle/Postgres query helpers for the station-scoped /api/reports/*
 * endpoints — Next-side port of `functions/_lib/report-queries.ts`.
 *
 * Conventions mirror the Cloudflare original:
 *   - station-scoped: every helper requires a stationId and uses it as the
 *     first WHERE predicate.
 *   - parametric only — user data never interpolated into SQL strings.
 *   - read-only: no mutation helpers live here; the reports surface is GET-only.
 *
 * SQLite → Postgres translation:
 *   - `played_at` is stored as a TEXT ISO 8601 string. We avoid casting to
 *     timestamp because keyset cursors elsewhere compare these columns as
 *     strings. Day/hour bucketing therefore uses `substring(played_at, …)`
 *     which is byte-identical for ISO 8601 inputs.
 *       day  → `substring(played_at, 1, 10)`   (e.g. `2026-05-01`)
 *       hour → `substring(played_at, 12, 2)`   (e.g. `14`)
 *     `date(played_at)` in the SQLite overview query becomes
 *     `substring(played_at, 1, 10)` for the same reason.
 *   - `COUNT(*)` and `COUNT(DISTINCT …)` are cast to `int` so pg-mem doesn't
 *     return BigInt for small fixtures (and so production callers don't have
 *     to defensively coerce).
 *   - `COALESCE(SUM(...), 0) / 3600000.0` keeps the original real-valued
 *     listening-hours computation.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β6.
 */

import { sql, type SQL } from 'drizzle-orm';

import type { DbClient } from '@/db/client';

export const REPORT_DEFAULT_TOP_LIMIT = 25;
export const REPORT_MAX_TOP_LIMIT = 200;

export interface DateRange {
  /** ISO 8601 lower bound, inclusive (`played_at >= ?`). */
  from?: string;
  /** ISO 8601 upper bound, exclusive (`played_at < ?`). */
  to?: string;
}

export interface ReportFilters {
  /** Free-form source string — callers should whitelist before passing in. */
  source?: string;
}

export interface OverviewRow {
  totalPlays: number;
  uniqueTitles: number;
  daysWithActivity: number;
  totalListeningHours: number;
}

export interface PlaysByDayRow {
  day: string;
  plays: number;
}

export interface TopTrackRow {
  title: string;
  artist: string | null;
  plays: number;
}

export interface TopHourRow {
  hour: string;
  plays: number;
}

export interface SourceBreakdownRow {
  source: string;
  plays: number;
}

/**
 * Clamp a positive integer into `[1, max]`, falling back to `def` for
 * undefined / NaN / non-positive input.
 */
export function clampLimit(
  value: number | undefined,
  max: number,
  def: number,
): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return def;
  if (value > max) return max;
  return Math.floor(value);
}

function requireStationId(stationId: string): void {
  if (!stationId) throw new Error('stationId is required');
}

/**
 * Build the `played_at` WHERE fragment shared by every report. Returns a
 * Drizzle `SQL` chunk that can be joined into a larger statement, or `null`
 * when no range filter is needed.
 */
function dateRangeFragment(range: DateRange): SQL | null {
  const parts: SQL[] = [];
  if (range.from) parts.push(sql`played_at >= ${range.from}`);
  if (range.to) parts.push(sql`played_at < ${range.to}`);
  if (parts.length === 0) return null;
  return sql.join(parts, sql` AND `);
}

/**
 * Treat aggregate results uniformly — pg-mem occasionally returns BigInt for
 * COUNT/SUM, so every numeric column from a report query goes through this.
 */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

interface ExecResult {
  rows: Array<Record<string, unknown>>;
}

async function execRows(db: DbClient, statement: SQL): Promise<ExecResult['rows']> {
  const raw = (await db.execute(statement)) as
    | ExecResult
    | Array<Record<string, unknown>>;
  return Array.isArray(raw) ? raw : (raw.rows ?? []);
}

/**
 * Headline numbers for the Reports overview card.
 *
 *   SELECT
 *     COUNT(*) AS total_plays,
 *     COUNT(DISTINCT title_snapshot || '|' || COALESCE(artist_snapshot,'')) AS unique_titles,
 *     COUNT(DISTINCT substring(played_at, 1, 10))                            AS days_with_activity,
 *     COALESCE(SUM(duration_played_ms), 0) / 3600000.0                       AS total_listening_hours
 *   FROM play_log
 *   WHERE station_id = ? [AND played_at >= ?] [AND played_at < ?]
 */
export async function queryOverview(
  db: DbClient,
  stationId: string,
  range: DateRange,
): Promise<OverviewRow> {
  requireStationId(stationId);
  const range$ = dateRangeFragment(range);
  const where = range$
    ? sql`station_id = ${stationId} AND ${range$}`
    : sql`station_id = ${stationId}`;

  const statement = sql`SELECT
      COUNT(*)::int AS total_plays,
      COUNT(DISTINCT title_snapshot || '|' || COALESCE(artist_snapshot, ''))::int AS unique_titles,
      COUNT(DISTINCT substring(played_at, 1, 10))::int AS days_with_activity,
      COALESCE(SUM(duration_played_ms), 0)::float / 3600000.0 AS total_listening_hours
    FROM play_log
    WHERE ${where}`;

  const rows = await execRows(db, statement);
  const row = rows[0] ?? {};
  return {
    totalPlays: toNumber(row.total_plays),
    uniqueTitles: toNumber(row.unique_titles),
    daysWithActivity: toNumber(row.days_with_activity),
    totalListeningHours: toNumber(row.total_listening_hours),
  };
}

/**
 * Plays per day, ascending — feeds the Tremor line / bar chart.
 *
 *   SELECT substring(played_at, 1, 10) AS day, COUNT(*) AS plays
 *   FROM play_log
 *   WHERE station_id = ? [...]
 *   GROUP BY day
 *   ORDER BY day ASC
 */
export async function queryPlaysByDay(
  db: DbClient,
  stationId: string,
  range: DateRange,
  filters: ReportFilters = {},
): Promise<PlaysByDayRow[]> {
  requireStationId(stationId);
  const parts: SQL[] = [sql`station_id = ${stationId}`];
  const range$ = dateRangeFragment(range);
  if (range$) parts.push(range$);
  if (filters.source) parts.push(sql`source = ${filters.source}`);
  const where = sql.join(parts, sql` AND `);

  const statement = sql`SELECT substring(played_at, 1, 10) AS day, COUNT(*)::int AS plays
    FROM play_log
    WHERE ${where}
    GROUP BY substring(played_at, 1, 10)
    ORDER BY substring(played_at, 1, 10) ASC`;

  const rows = await execRows(db, statement);
  return rows.map((r) => ({
    day: String(r.day),
    plays: toNumber(r.plays),
  }));
}

export interface TopTracksOptions {
  limit?: number;
  source?: string;
}

/**
 * Top N tracks by play count, grouped by snapshot (title, artist).
 *
 *   SELECT title_snapshot AS title, artist_snapshot AS artist, COUNT(*) AS plays
 *   FROM play_log
 *   WHERE station_id = ? [...]
 *   GROUP BY title_snapshot, artist_snapshot
 *   ORDER BY plays DESC, title_snapshot ASC
 *   LIMIT N
 */
export async function queryTopTracks(
  db: DbClient,
  stationId: string,
  range: DateRange,
  opts: TopTracksOptions = {},
): Promise<{ tracks: TopTrackRow[]; limit: number }> {
  requireStationId(stationId);
  const limit = clampLimit(
    opts.limit,
    REPORT_MAX_TOP_LIMIT,
    REPORT_DEFAULT_TOP_LIMIT,
  );
  const parts: SQL[] = [sql`station_id = ${stationId}`];
  const range$ = dateRangeFragment(range);
  if (range$) parts.push(range$);
  if (opts.source) parts.push(sql`source = ${opts.source}`);
  const where = sql.join(parts, sql` AND `);

  const statement = sql`SELECT title_snapshot AS title, artist_snapshot AS artist, COUNT(*)::int AS plays
    FROM play_log
    WHERE ${where}
    GROUP BY title_snapshot, artist_snapshot
    ORDER BY plays DESC, title_snapshot ASC
    LIMIT ${limit}`;

  const rows = await execRows(db, statement);
  const tracks: TopTrackRow[] = rows.map((r) => ({
    title: String(r.title),
    artist: r.artist === null || r.artist === undefined ? null : String(r.artist),
    plays: toNumber(r.plays),
  }));
  return { tracks, limit };
}

/**
 * Top hours of the day by play count — drives the "when do we broadcast?"
 * heat-strip in the Reports UI. Hours come back as zero-padded `"00"`..`"23"`
 * strings so the endpoint can zero-fill the missing buckets without inventing
 * extra DB round-trips.
 */
export async function queryTopHours(
  db: DbClient,
  stationId: string,
  range: DateRange,
): Promise<TopHourRow[]> {
  requireStationId(stationId);
  const parts: SQL[] = [sql`station_id = ${stationId}`];
  const range$ = dateRangeFragment(range);
  if (range$) parts.push(range$);
  const where = sql.join(parts, sql` AND `);

  const statement = sql`SELECT substring(played_at, 12, 2) AS hour, COUNT(*)::int AS plays
    FROM play_log
    WHERE ${where}
    GROUP BY substring(played_at, 12, 2)
    ORDER BY substring(played_at, 12, 2) ASC`;

  const rows = await execRows(db, statement);
  return rows.map((r) => ({
    hour: String(r.hour ?? ''),
    plays: toNumber(r.plays),
  }));
}

/**
 * Plays grouped by source — automation vs manual vs voice_track etc.
 */
export async function querySourceBreakdown(
  db: DbClient,
  stationId: string,
  range: DateRange,
): Promise<SourceBreakdownRow[]> {
  requireStationId(stationId);
  const parts: SQL[] = [sql`station_id = ${stationId}`];
  const range$ = dateRangeFragment(range);
  if (range$) parts.push(range$);
  const where = sql.join(parts, sql` AND `);

  const statement = sql`SELECT source, COUNT(*)::int AS plays
    FROM play_log
    WHERE ${where}
    GROUP BY source
    ORDER BY plays DESC`;

  const rows = await execRows(db, statement);
  return rows.map((r) => ({
    source: String(r.source),
    plays: toNumber(r.plays),
  }));
}
