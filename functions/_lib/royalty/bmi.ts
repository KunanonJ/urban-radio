/// <reference types="@cloudflare/workers-types" />

/**
 * BMI performance report emitter (CSV).
 *
 * BMI's radio reporting expects roughly the same data as ASCAP but with
 * different column labels and ordering, plus a "FeatureType" column that
 * categorises the type of performance. The v1 column set per ROADMAP §6.1
 * D24:
 *
 *   SongTitle,Artist,ISRC,ISWC,PlayDate,PlayTime,DurationSeconds,FeatureType
 *
 * We pass through `play_log.source` as the FeatureType value so the importer
 * sees one of our six controlled-vocab values (automation, manual, live_dj,
 * voice_track, cart, spot). BMI's intake mapping for these is documented
 * separately by the licensing team.
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ctx: StationContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _range: RoyaltyRange,
  ): string {
    return buildCsv(BMI_COLUMNS, rows.map(rowFor));
  },
};
