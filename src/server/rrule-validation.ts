/**
 * Server-side RRULE validation — Next-side port of
 * `functions/_lib/rrule-validation.ts`.
 *
 * RFC 5545 recurrence rules are parsed via the `rrule` package. The validator
 * round-trips through `rrulestr` → `toString()` to:
 *   1. Reject obviously invalid input (`FREQ=GIBBERISH`, malformed BYDAY, ...)
 *   2. Return a canonical, normalized form so we always persist the same
 *      surface bytes regardless of the user's casing / ordering.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { rrulestr } from 'rrule';

export interface RRuleValidationResult {
  ok: boolean;
  /** Reason the input was rejected. Always set when `ok === false`. */
  error?: string;
  /** Canonical RRULE string after parsing. Always set when `ok === true`. */
  normalized?: string;
}

export function validateRRule(input: string): RRuleValidationResult {
  if (!input || typeof input !== 'string') {
    return { ok: false, error: 'RRULE must be a non-empty string' };
  }
  try {
    const parsed = rrulestr(input);
    return { ok: true, normalized: parsed.toString() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Invalid RRULE',
    };
  }
}
