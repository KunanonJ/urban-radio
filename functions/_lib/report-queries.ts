/// <reference types="@cloudflare/workers-types" />

/**
 * Pure SQL builders for the station-scoped /api/reports/* endpoints.
 *
 * Same conventions as `play-log-queries.ts`:
 *   - station-scoped: every builder requires a stationId and uses it as the
 *     first WHERE predicate.
 *   - parametric only — user data never interpolated into SQL strings.
 *   - framework-free so it can be unit-tested without spinning up D1.
 *
 * D1 is SQLite, so day buckets use `strftime('%Y-%m-%d', played_at)` and
 * hour buckets use `strftime('%H', played_at)`. We accept the source filter
 * as a free `string` here — the endpoint layer is responsible for whitelisting
 * via `ALLOWED_SOURCES` from `play-log-queries.ts` (Zod enum).
 */

export const REPORT_DEFAULT_TOP_LIMIT = 25;
export const REPORT_MAX_TOP_LIMIT = 200;

export interface DateRange {
  /** ISO 8601 lower bound, inclusive. */
  from?: string;
  /** ISO 8601 upper bound, exclusive. */
  to?: string;
}

export interface ReportFilters {
  /** Free-form source string — endpoint layer should whitelist. */
  source?: string;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/**
 * Clamps a positive integer into `[1, max]`, falling back to `def` for
 * undefined / NaN / non-positive input. Re-exported from this module so the
 * Reports layer doesn't reach into play-log-queries.ts directly — keeps the
 * two SQL builder modules independent.
 */
export function clampLimit(value: number | undefined, max: number, def: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return def;
  if (value > max) return max;
  return Math.floor(value);
}

function requireStationId(stationId: string): void {
  if (!stationId) throw new Error('stationId is required');
}

function appendDateRange(
  range: DateRange,
  where: string[],
  params: unknown[],
): void {
  if (range.from) {
    where.push('played_at >= ?');
    params.push(range.from);
  }
  if (range.to) {
    where.push('played_at < ?');
    params.push(range.to);
  }
}

/**
 * Headline numbers for the Reports overview card.
 *
 * SELECT
 *   COUNT(*) AS totalPlays,
 *   COUNT(DISTINCT title_snapshot || '|' || COALESCE(artist_snapshot,'')) AS uniqueTitles,
 *   COUNT(DISTINCT date(played_at)) AS daysWithActivity,
 *   COALESCE(SUM(duration_played_ms), 0) / 3600000.0 AS totalListeningHours
 * FROM play_log
 * WHERE station_id = ? [AND played_at >= ?] [AND played_at < ?]
 */
export function buildOverviewQuery(stationId: string, range: DateRange): BuiltQuery {
  requireStationId(stationId);
  const where: string[] = ['station_id = ?'];
  const params: unknown[] = [stationId];
  appendDateRange(range, where, params);

  const sql = `SELECT
      COUNT(*) AS totalPlays,
      COUNT(DISTINCT title_snapshot || '|' || COALESCE(artist_snapshot, '')) AS uniqueTitles,
      COUNT(DISTINCT date(played_at)) AS daysWithActivity,
      COALESCE(SUM(duration_played_ms), 0) / 3600000.0 AS totalListeningHours
    FROM play_log
    WHERE ${where.join(' AND ')}`;

  return { sql, params };
}

/**
 * Plays per day, ascending — drives the Tremor line / bar chart.
 *
 * SELECT strftime('%Y-%m-%d', played_at) AS day, COUNT(*) AS plays
 * FROM play_log
 * WHERE station_id = ? [...]
 * GROUP BY day
 * ORDER BY day ASC
 */
export function buildPlaysByDayQuery(
  stationId: string,
  range: DateRange,
  filters?: ReportFilters,
): BuiltQuery {
  requireStationId(stationId);
  const where: string[] = ['station_id = ?'];
  const params: unknown[] = [stationId];
  appendDateRange(range, where, params);
  if (filters?.source) {
    where.push('source = ?');
    params.push(filters.source);
  }

  const sql = `SELECT strftime('%Y-%m-%d', played_at) AS day, COUNT(*) AS plays
    FROM play_log
    WHERE ${where.join(' AND ')}
    GROUP BY day
    ORDER BY day ASC`;

  return { sql, params };
}

export interface TopTracksOptions {
  limit?: number;
  source?: string;
}

/**
 * Top N tracks by play count, grouped by snapshot title+artist (matches the
 * royalty grouping). Limit is clamped server-side — the endpoint reflects the
 * final value back in the response so the UI can show pagination state.
 *
 * SELECT title_snapshot, artist_snapshot, COUNT(*) AS plays
 * FROM play_log
 * WHERE station_id = ? [...]
 * GROUP BY title_snapshot, artist_snapshot
 * ORDER BY plays DESC
 * LIMIT N
 */
export function buildTopTracksQuery(
  stationId: string,
  range: DateRange,
  opts: TopTracksOptions = {},
): BuiltQuery {
  requireStationId(stationId);
  const where: string[] = ['station_id = ?'];
  const params: unknown[] = [stationId];
  appendDateRange(range, where, params);
  if (opts.source) {
    where.push('source = ?');
    params.push(opts.source);
  }
  const limit = clampLimit(opts.limit, REPORT_MAX_TOP_LIMIT, REPORT_DEFAULT_TOP_LIMIT);

  const sql = `SELECT title_snapshot, artist_snapshot, COUNT(*) AS plays
    FROM play_log
    WHERE ${where.join(' AND ')}
    GROUP BY title_snapshot, artist_snapshot
    ORDER BY plays DESC, title_snapshot ASC
    LIMIT ${limit}`;

  return { sql, params };
}

/**
 * Top hours of the day by play count — drives the "when do we broadcast?"
 * heat-strip in the Reports UI.
 *
 * SELECT strftime('%H', played_at) AS hour, COUNT(*) AS plays
 * FROM play_log
 * WHERE station_id = ? [...]
 * GROUP BY hour
 * ORDER BY hour ASC
 *
 * Returns up to 24 rows (one per hour with data). The endpoint zero-fills
 * the missing hours so the chart always shows 0..23.
 */
export function buildTopHoursQuery(stationId: string, range: DateRange): BuiltQuery {
  requireStationId(stationId);
  const where: string[] = ['station_id = ?'];
  const params: unknown[] = [stationId];
  appendDateRange(range, where, params);

  const sql = `SELECT strftime('%H', played_at) AS hour, COUNT(*) AS plays
    FROM play_log
    WHERE ${where.join(' AND ')}
    GROUP BY hour
    ORDER BY hour ASC`;

  return { sql, params };
}

/**
 * Plays grouped by source — automation vs manual vs voice_track etc.
 *
 * SELECT source, COUNT(*) AS plays
 * FROM play_log
 * WHERE station_id = ? [...]
 * GROUP BY source
 */
export function buildSourceBreakdownQuery(
  stationId: string,
  range: DateRange,
): BuiltQuery {
  requireStationId(stationId);
  const where: string[] = ['station_id = ?'];
  const params: unknown[] = [stationId];
  appendDateRange(range, where, params);

  const sql = `SELECT source, COUNT(*) AS plays
    FROM play_log
    WHERE ${where.join(' AND ')}
    GROUP BY source
    ORDER BY plays DESC`;

  return { sql, params };
}
