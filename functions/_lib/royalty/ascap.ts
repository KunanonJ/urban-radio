/// <reference types="@cloudflare/workers-types" />

/**
 * ASCAP performance report emitter (CSV).
 *
 * ASCAP's published radio reporting templates use a per-performance CSV with
 * columns covering the work, the writer/performer credit, ISWC/ISRC, and
 * play timestamp + duration. The v1 column set per ROADMAP §6.1 D24:
 *
 *   TitleOfWork,WriterPerformer,ISWC,ISRC,Date,TimePlayed,DurationSeconds,Source
 *
 * If ASCAP changes their accepted column list, bump the emitter version and
 * supply a new format identifier rather than mutating this one.
 */
import {
  buildCsv,
  formatDate,
  formatDurationSeconds,
  formatTime,
  type RoyaltyEmitter,
  type RoyaltyRange,
  type RoyaltyRow,
  type StationContext,
} from './index';

export const ASCAP_COLUMNS = [
  'TitleOfWork',
  'WriterPerformer',
  'ISWC',
  'ISRC',
  'Date',
  'TimePlayed',
  'DurationSeconds',
  'Source',
] as const;

function rowFor(input: RoyaltyRow): ReadonlyArray<string> {
  return [
    input.title,
    input.artist ?? '',
    input.iswc ?? '',
    input.isrc ?? '',
    formatDate(input.playedAt),
    formatTime(input.playedAt),
    formatDurationSeconds(input.durationMs),
    input.source,
  ];
}

export const ascapEmitter: RoyaltyEmitter = {
  format: 'ascap',
  mimeType: 'text/csv',
  fileExtension: 'csv',
  emit(
    rows: ReadonlyArray<RoyaltyRow>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ctx: StationContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _range: RoyaltyRange,
  ): string {
    return buildCsv(ASCAP_COLUMNS, rows.map(rowFor));
  },
};
