/**
 * BMI performance report emitter (CSV).
 *
 * Ports `functions/_lib/royalty/bmi.ts` byte-for-byte. Column order MUST
 * match the Cloudflare emitter so dual-stack PRO submissions stay identical:
 *
 *   SongTitle,Artist,ISRC,ISWC,PlayDate,PlayTime,DurationSeconds,FeatureType
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

export const BMI_COLUMNS = [
  'SongTitle',
  'Artist',
  'ISRC',
  'ISWC',
  'PlayDate',
  'PlayTime',
  'DurationSeconds',
  'FeatureType',
] as const;

function rowFor(input: RoyaltyRow): ReadonlyArray<string> {
  return [
    input.title,
    input.artist ?? '',
    input.isrc ?? '',
    input.iswc ?? '',
    formatDate(input.playedAt),
    formatTime(input.playedAt),
    formatDurationSeconds(input.durationMs),
    input.source,
  ];
}

export const bmiEmitter: RoyaltyEmitter = {
  format: 'bmi',
  mimeType: 'text/csv',
  fileExtension: 'csv',
  emit(
    rows: ReadonlyArray<RoyaltyRow>,
    _ctx: StationContext,
    _range: RoyaltyRange,
  ): string {
    void _ctx;
    void _range;
    return buildCsv(BMI_COLUMNS, rows.map(rowFor));
  },
};
