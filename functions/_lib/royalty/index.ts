/// <reference types="@cloudflare/workers-types" />

/**
 * Royalty export emitters — shared types, CSV helpers, and dispatcher.
 *
 * Phase 5 ships ASCAP + BMI + SoundExchange per ROADMAP §6.1 D24. Each
 * emitter is a pure function that takes the canonical input shape and
 * returns a CSV string. The endpoint layer (`functions/api/royalty/export.ts`)
 * is responsible for auth, range validation, D1 reads, and the response
 * envelope; this module is framework-free so it can be unit-tested directly.
 *
 * Notes on the CSV format:
 *
 * - Each emitter prepends a UTF-8 BOM (`﻿`) byte. Some PRO importers
 *   (especially Excel-based intake from smaller ASCAP/BMI account managers)
 *   require the BOM. Harmless for tooling that doesn't need it.
 * - Line endings are CRLF per RFC 4180.
 * - Fields are wrapped in double quotes only when they contain `,`, `"`,
 *   CR, or LF. Embedded double quotes are doubled.
 */
import { ascapEmitter } from './ascap';
import { bmiEmitter } from './bmi';
import { soundExchangeEmitter } from './soundexchange';

// ---------------------------------------------------------------------------
// Canonical input shapes
// ---------------------------------------------------------------------------

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

/**
 * Per-station metadata embedded in PRO reports. `stationCallSign` and
 * `ownerName` are optional because not every PRO format references them and
 * the `stations` table doesn't yet model them as first-class columns.
 */
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
   * byte-for-byte. No I/O, no Date.now(), no randomness.
   */
  emit(rows: ReadonlyArray<RoyaltyRow>, ctx: StationContext, range: RoyaltyRange): string;
}

// ---------------------------------------------------------------------------
// Shared CSV helpers
// ---------------------------------------------------------------------------

/** UTF-8 Byte Order Mark. Required by some PRO importers. */
export const BOM = '﻿';
export const CRLF = '\r\n';

const NEEDS_QUOTE_RE = /[",\r\n]/;

export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (!NEEDS_QUOTE_RE.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

export function csvRow(cells: ReadonlyArray<string | number | null | undefined>): string {
  return cells.map(csvEscape).join(',');
}

/**
 * Build a complete CSV string from a header row + data rows, prepended with
 * a UTF-8 BOM and terminated with CRLF. A trailing CRLF is emitted after the
 * last record (the RFC 4180 "optional EOL on the last record" form — most
 * PRO importers accept both, but explicit is safer).
 */
export function buildCsv(
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  const lines: string[] = [csvRow(header)];
  for (const row of rows) lines.push(csvRow(row));
  return BOM + lines.join(CRLF) + CRLF;
}

/**
 * Format an ISO 8601 instant as `YYYY-MM-DD` in UTC. UTC matches the
 * `datetime('now')` storage convention used by D1 throughout this project.
 * Invalid input → empty string (graceful fallback).
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format an ISO 8601 instant as `HH:MM:SS` in UTC. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mm = d.getUTCMinutes().toString().padStart(2, '0');
  const ss = d.getUTCSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/**
 * Convert `duration_played_ms` to whole seconds, rounded. null/non-finite →
 * empty string so the CSV cell remains blank rather than `NaN`.
 */
export function formatDurationSeconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '';
  if (!Number.isFinite(ms)) return '';
  return Math.round(ms / 1000).toString();
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

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
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EMITTERS, value);
}

export function getEmitter(format: RoyaltyFormat): RoyaltyEmitter {
  const emitter = EMITTERS[format];
  if (!emitter) {
    throw new Error(`Unknown royalty format: ${String(format)}`);
  }
  return emitter;
}
