/**
 * SoundExchange Digital Performance Report (DPR) emitter (CSV).
 *
 * Ports `functions/_lib/royalty/soundexchange.ts` byte-for-byte. Columns:
 *
 *   NameOfService,TransmissionCategory,FeaturedArtist,SoundRecordingTitle,
 *   ISRC,Album,MarketingLabel,ActualTotalPerformances
 *
 * Same v1 mapping notes apply (Album, MarketingLabel still blank; one
 * performance per row). See `functions/_lib/royalty/soundexchange.ts` for
 * the full follow-up list.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { buildCsv } from './csv';
import type {
  RoyaltyEmitter,
  RoyaltyRange,
  RoyaltyRow,
  StationContext,
} from './index';

export const SOUNDEXCHANGE_COLUMNS = [
  'NameOfService',
  'TransmissionCategory',
  'FeaturedArtist',
  'SoundRecordingTitle',
  'ISRC',
  'Album',
  'MarketingLabel',
  'ActualTotalPerformances',
] as const;

export const SOUNDEXCHANGE_TRANSMISSION_CATEGORY = 'Webcasting';

function rowFor(
  input: RoyaltyRow,
  ctx: StationContext,
): ReadonlyArray<string | number> {
  return [
    ctx.stationName,
    SOUNDEXCHANGE_TRANSMISSION_CATEGORY,
    input.artist ?? '',
    input.title,
    input.isrc ?? '',
    '', // Album — FOLLOW-UP
    '', // MarketingLabel — FOLLOW-UP
    1,
  ];
}

export const soundExchangeEmitter: RoyaltyEmitter = {
  format: 'soundexchange',
  mimeType: 'text/csv',
  fileExtension: 'csv',
  emit(
    rows: ReadonlyArray<RoyaltyRow>,
    ctx: StationContext,
    _range: RoyaltyRange,
  ): string {
    void _range;
    return buildCsv(
      SOUNDEXCHANGE_COLUMNS,
      rows.map((r) => rowFor(r, ctx)),
    );
  },
};
