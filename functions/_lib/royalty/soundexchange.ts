/// <reference types="@cloudflare/workers-types" />

/**
 * SoundExchange Digital Performance Report (DPR) emitter (CSV).
 *
 * SoundExchange operates differently from ASCAP/BMI: it covers digital
 * performances of sound recordings (the recording side of the right), and
 * the DPR template emphasises the *service* that made the transmission and
 * a per-recording performance count. The v1 column set per ROADMAP §6.1
 * D24:
 *
 *   NameOfService,TransmissionCategory,FeaturedArtist,SoundRecordingTitle,
 *   ISRC,Album,MarketingLabel,ActualTotalPerformances
 *
 * v1 mapping notes / known gaps (flagged for follow-up):
 *
 * - **NameOfService**            ← `StationContext.stationName`.
 * - **TransmissionCategory**     ← fixed to `Webcasting`. Sub-categorisation
 *                                  (Pre-Existing, NSC, etc.) becomes a
 *                                  follow-up when we model service tiers.
 * - **FeaturedArtist**           ← `artist_snapshot` from play_log.
 * - **SoundRecordingTitle**      ← `title_snapshot` from play_log.
 * - **ISRC**                     ← `isrc` from play_log.
 * - **Album** and
 *   **MarketingLabel**           ← NOT YET captured on radio_tracks or
 *                                  play_log. Emitted blank in v1.
 *                                  FOLLOW-UP: add `album` and `label`
 *                                  columns to `radio_tracks` (and snapshot
 *                                  them on play_log) before SoundExchange
 *                                  acceptance testing.
 * - **ActualTotalPerformances**  ← 1 per row in v1 (one RoyaltyRow == one
 *                                  performance event). FOLLOW-UP: optional
 *                                  aggregation mode (GROUP BY ISRC, Album)
 *                                  once Album/Label columns exist.
 */
import {
  buildCsv,
  type RoyaltyEmitter,
  type RoyaltyRange,
  type RoyaltyRow,
  type StationContext,
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

/**
 * v1 fixes the transmission category to Webcasting. Expand once the product
 * gains a service-tier model.
 */
export const SOUNDEXCHANGE_TRANSMISSION_CATEGORY = 'Webcasting';

function rowFor(input: RoyaltyRow, ctx: StationContext): ReadonlyArray<string | number> {
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _range: RoyaltyRange,
  ): string {
    return buildCsv(
      SOUNDEXCHANGE_COLUMNS,
      rows.map((r) => rowFor(r, ctx)),
    );
  },
};
