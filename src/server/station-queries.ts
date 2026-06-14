/**
 * Validators for the station identity endpoint.
 *
 * Ports the pure validators from `functions/_lib/station-queries.ts`. The
 * Cloudflare module also exported SQL builders for D1; on the Railway side
 * those are obsolete — Drizzle's query builder handles the SQL — so only the
 * validators remain.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

/**
 * PATCH body: every field is optional. `streamUrl: null` is the supported
 * way to clear the column. A patch that does not include `streamUrl` leaves
 * the existing value alone.
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

/** Server-side row shape returned to the API JSON. */
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
 * Best-effort IANA timezone check via `Intl.DateTimeFormat`. The spec mandates
 * that invalid identifiers throw a RangeError, so a `try {} catch {}` is the
 * canonical detector. Empty/whitespace strings are rejected before the call
 * to avoid relying on engine-specific coercion.
 */
export function validateIanaTimezone(tz: string): boolean {
  if (typeof tz !== 'string') return false;
  const trimmed = tz.trim();
  if (trimmed.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a BCP-47-ish language code. Permissive on purpose — accepts
 * primary subtag (2-3 letters) with optional region/script suffix.
 */
export function validateLanguage(code: string): boolean {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  if (trimmed.length < 2 || trimmed.length > 10) return false;
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(trimmed);
}
