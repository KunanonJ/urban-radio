/// <reference types="@cloudflare/workers-types" />

/**
 * Pure SQL builders + validators for the station identity endpoint.
 *
 * Same conventions as clock-queries.ts / catalog-queries.ts:
 *   - station-scoped (mutation path matches by id only — stationId comes from
 *     the auth gate, so a member of station A cannot mutate station B)
 *   - parametric only — no string interpolation of user data
 *   - framework-free so they can be unit-tested without D1
 *
 * Schema reference: migrations/0004_radio_schema.sql:20-30
 *   stations(id, org_id, slug, name, timezone, stream_url, language, created_at)
 *   UNIQUE(org_id, slug)
 */

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

/** Server-side row shape returned from D1 then mapped to the API JSON. */
export interface StationRow {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  timezone: string;
  streamUrl: string | null;
  language: string;
  createdAt: string;
}

/**
 * PATCH body: every field is optional. Slug + id + orgId are read-only via
 * this endpoint (the slug is referenced by external URLs and routing — a
 * follow-up endpoint would handle a slug rename with reverse-lookup
 * updates).
 */
export interface StationIdentityPatch {
  /** 1..100 chars. */
  name?: string;
  /** IANA tz id (e.g. `UTC`, `Asia/Bangkok`). */
  timezone?: string;
  /** BCP-47 / ISO 639 code; 2..10 chars, letters + optional `-region`. */
  language?: string;
  /** URL or null to clear. */
  streamUrl?: string | null;
}

const STATION_COLUMNS =
  'id, org_id, slug, name, timezone, stream_url, language, created_at';

function requireStationId(stationId: string): void {
  if (!stationId) throw new Error('stationId is required');
}

/** SELECT for the auth gate's stationId. */
export function buildStationGetQuery(stationId: string): BuiltQuery {
  requireStationId(stationId);
  const sql = `SELECT ${STATION_COLUMNS}
    FROM stations
    WHERE id = ?
    LIMIT 1`;
  return { sql, params: [stationId] };
}

/**
 * Partial update: only writes columns that are explicitly passed. Empty
 * patches throw — the endpoint validates this earlier with a 400, but we
 * defend in depth.
 *
 * `streamUrl: null` is the supported way to clear the column. A patch that
 * does not include `streamUrl` will leave the existing value alone.
 */
export function buildStationUpdateQuery(
  stationId: string,
  patch: StationIdentityPatch,
): BuiltQuery {
  requireStationId(stationId);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (patch.timezone !== undefined) {
    sets.push('timezone = ?');
    params.push(patch.timezone);
  }
  if (patch.language !== undefined) {
    sets.push('language = ?');
    params.push(patch.language);
  }
  if (patch.streamUrl !== undefined) {
    sets.push('stream_url = ?');
    params.push(patch.streamUrl);
  }
  if (sets.length === 0) throw new Error('empty patch');
  const sql = `UPDATE stations SET ${sets.join(', ')} WHERE id = ?`;
  params.push(stationId);
  return { sql, params };
}

/**
 * Best-effort IANA timezone check. Uses the `Intl.DateTimeFormat`
 * constructor — the spec mandates that invalid identifiers throw a
 * RangeError with `Invalid time zone` in its message. Returns false on any
 * throw or non-string input.
 *
 * Gotcha: Intl is locale-DB dependent (Cloudflare Workers' V8 ships the
 * full ICU DB so common identifiers work). Empty/whitespace strings are
 * rejected before the Intl call to avoid relying on engine-specific
 * coercion behavior.
 */
export function validateIanaTimezone(tz: string): boolean {
  if (typeof tz !== 'string') return false;
  const trimmed = tz.trim();
  if (trimmed.length === 0) return false;
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a BCP-47-ish language code. Permissive on purpose — accepts
 * primary subtag (2-3 letters) with optional region/script suffix.
 *
 * Examples that pass: en, th, en-US, zh-Hant.
 * Examples that fail: empty, single letter, digits, anything > 10 chars.
 */
export function validateLanguage(code: string): boolean {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  if (trimmed.length < 2 || trimmed.length > 10) return false;
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(trimmed);
}
