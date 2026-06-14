/**
 * Royalty export emitters — shared types and dispatcher.
 *
 * Ports `functions/_lib/royalty/index.ts` minus the CSV helpers (those live
 * in `./csv` so the Next emitters can import without pulling the dispatcher).
 * Each emitter is a pure function that takes the canonical input shape and
 * returns a CSV string byte-identical to the Cloudflare side, preserving the
 * dual-stack contract for PRO submissions.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { ascapEmitter } from './ascap';
import { bmiEmitter } from './bmi';
import { soundExchangeEmitter } from './soundexchange';

/**
 * Canonical input row for every PRO emitter. Derived from `play_log` rows by
 * the export endpoint. Field names are neutral — each emitter maps them to
 * its own PRO-specific column labels.
 */
export interface RoyaltyRow {
  /** ISO 8601 timestamp of when the track was played. */
  playedAt: string;
  /** `title_snapshot` from play_log. */
  title: string;
  /** `artist_snapshot` from play_log. */
  artist: string | null;
  /** `duration_played_ms` from play_log. */
  durationMs: number | null;
  /** International Standard Recording Code, if known. */
  isrc: string | null;
  /** International Standard Musical Work Code, if known. */
  iswc: string | null;
  /** play_log.source — e.g. 'automation', 'live_dj'. */
  source: string;
}

export interface StationContext {
  stationId: string;
  stationName: string;
  stationCallSign?: string;
  ownerName?: string;
}

/** ISO 8601 inclusive lower / exclusive upper range. */
export interface RoyaltyRange {
  from: string;
  to: string;
}

export type RoyaltyFormat = 'ascap' | 'bmi' | 'soundexchange';

export interface RoyaltyEmitter {
  format: RoyaltyFormat;
  mimeType: string;
  fileExtension: string;
  /**
   * Pure function: given the same inputs it must return the same CSV string
   * byte-for-byte.
   */
  emit(
    rows: ReadonlyArray<RoyaltyRow>,
    ctx: StationContext,
    range: RoyaltyRange,
  ): string;
}

const EMITTERS: Record<RoyaltyFormat, RoyaltyEmitter> = {
  ascap: ascapEmitter,
  bmi: bmiEmitter,
  soundexchange: soundExchangeEmitter,
};

export const SUPPORTED_FORMATS: ReadonlyArray<RoyaltyFormat> = [
  'ascap',
  'bmi',
  'soundexchange',
];

export function isRoyaltyFormat(value: unknown): value is RoyaltyFormat {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(EMITTERS, value)
  );
}

export function getEmitter(format: RoyaltyFormat): RoyaltyEmitter {
  const emitter = EMITTERS[format];
  if (!emitter) {
    throw new Error(`Unknown royalty format: ${String(format)}`);
  }
  return emitter;
}
