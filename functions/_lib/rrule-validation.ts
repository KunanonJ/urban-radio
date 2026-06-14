/**
 * Server-side RRULE validation.
 *
 * RFC 5545 recurrence rules are parsed via the `rrule` package. The validator
 * round-trips through `rrulestr` → `toString()` to:
 *   1. Reject obviously invalid input (`FREQ=GIBBERISH`, malformed BYDAY, …)
 *   2. Return a canonical, normalized form so we always persist the same
 *      surface bytes regardless of the user's casing / ordering.
 *
 * NOTE: The `rrule` library is permissive about a number of forms. We do not
 * attempt to enforce a stricter subset beyond what it parses — that lives at
 * the UI layer if needed.
 */

import { rrulestr } from 'rrule';

export interface RRuleValidationResult {
  ok: boolean;
  /** Reason the input was rejected. Always set when `ok === false`. */
  error?: string;
  /** Canonical RRULE string after parsing. Always set when `ok === true`. */
  normalized?: string;
}

/**
 * Validate an RRULE string and return a normalized form if it parses cleanly.
 *
 * Accepts both raw `FREQ=…` and the `RRULE:FREQ=…` prefix variant defined in
 * RFC 5545. Empty or non-string input is rejected with a clear error.
 */
export function validateRRule(input: string): RRuleValidationResult {
  if (!input || typeof input !== 'string') {
    return { ok: false, error: 'RRULE must be a non-empty string' };
  }
  try {
    const parsed = rrulestr(input);
    // `toString()` returns the canonical RRULE form. Re-stringifying is the
    // sharpest cheap test that the library actually understood the rule.
    return { ok: true, normalized: parsed.toString() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid RRULE',
    };
  }
}

/**
 * Best-effort human-readable description of an RRULE for the UI. Falls back
 * to the raw input if the rule does not parse. This is intentionally simple —
 * the `rrule` library ships a `toText()` helper, but we keep this local so we
 * never throw on unfamiliar inputs.
 */
export function describeRRule(input: string): string {
  if (!input) return '';
  try {
    const parsed = rrulestr(input);
    // `toText()` returns English by default. Returns a fallback canonical form
    // if the library cannot synthesise a phrase (rare for valid input).
    if ('toText' in parsed && typeof parsed.toText === 'function') {
      const text = parsed.toText();
      if (text && text.trim().length > 0) return text;
    }
    return parsed.toString();
  } catch {
    return input;
  }
}
