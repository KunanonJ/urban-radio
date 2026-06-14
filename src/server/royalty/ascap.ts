/**
 * ASCAP performance report emitter (CSV).
 *
 * Ports `functions/_lib/royalty/ascap.ts` byte-for-byte. Column order MUST
 * match the Cloudflare emitter so dual-stack PRO submissions stay identical:
 *
 *   TitleOfWork,WriterPerformer,ISWC,ISRC,Date,TimePlayed,DurationSeconds,Source
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import {
  buildCsv,
  formatDate,
  formatDurationSeconds,
  formatTime,
} from './csv';
import type {
  RoyaltyEmitter,
  RoyaltyRange,
  RoyaltyRow,
  StationContext,
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
    _ctx: StationContext,
    _range: RoyaltyRange,
  ): string {
    void _ctx;
    void _range;
    return buildCsv(ASCAP_COLUMNS, rows.map(rowFor));
  },
};
