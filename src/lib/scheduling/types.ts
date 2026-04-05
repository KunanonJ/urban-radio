import type { Track, RotationCategory } from '@/types/track';
import type { Campaign, CampaignPriority } from '@/types/campaign';
import type { Spot } from '@/types/spot';
import type { ClockSegment } from '@/types/clock-template';
import type { RundownItem, ConflictFlag } from '@/types/rundown';
import type { SongSeparationRules, AdRules } from '@/types/station';

/** Cooldown per rotation category in hours */
export const ROTATION_COOLDOWNS: Record<RotationCategory, number> = {
  A: 2,
  B: 4,
  C: 8,
  RECURRENT: 12,
  GOLD: 24,
  INACTIVE: Infinity,
};

/** Selection weight per rotation category */
export const ROTATION_WEIGHTS: Record<RotationCategory, number> = {
  A: 4,
  B: 2,
  C: 1,
  RECURRENT: 1.5,
  GOLD: 0.5,
  INACTIVE: 0,
};

/** Priority weight for ad scoring */
export const PRIORITY_WEIGHTS: Record<CampaignPriority, number> = {
  low: 1,
  normal: 2,
  high: 4,
  guaranteed: 10,
};

/** Duration tolerance in seconds for track matching */
export const DURATION_TOLERANCE_SEC = 15;

export interface SchedulingContext {
  readonly date: string;
  readonly hour: number;
  readonly dayOfWeek: number; // 0 = Sunday
  readonly explicitAllowed: boolean;
  readonly songRules: SongSeparationRules;
  readonly adRules: AdRules;
}

export interface PlayHistory {
  /** Track ID -> ISO timestamps of recent plays */
  readonly trackPlays: ReadonlyMap<string, readonly string[]>;
  /** Artist ID -> ISO timestamps of recent plays */
  readonly artistPlays: ReadonlyMap<string, readonly string[]>;
  /** Advertiser ID -> ISO timestamps of recent plays */
  readonly advertiserPlays: ReadonlyMap<string, readonly string[]>;
  /** Campaign ID -> number of plays to date */
  readonly campaignPlayCounts: ReadonlyMap<string, number>;
}

export interface SongSelectorInput {
  readonly segment: ClockSegment;
  readonly tracks: readonly Track[];
  readonly context: SchedulingContext;
  readonly history: PlayHistory;
  readonly currentHourItems: readonly RundownItem[];
}

export interface SongSelectorResult {
  readonly track: Track | null;
  readonly conflicts: readonly ConflictFlag[];
}

export interface AdSelectorInput {
  readonly segment: ClockSegment;
  readonly campaigns: readonly Campaign[];
  readonly spots: ReadonlyMap<string, readonly Spot[]>;
  readonly context: SchedulingContext;
  readonly history: PlayHistory;
  readonly currentHourItems: readonly RundownItem[];
}

export interface AdSelectorResult {
  readonly spot: Spot | null;
  readonly campaign: Campaign | null;
  readonly conflicts: readonly ConflictFlag[];
}

export interface AutoFillInput {
  readonly date: string;
  readonly hours: readonly { hour: number; clockTemplateId: string }[];
  readonly templates: ReadonlyMap<string, { segments: readonly ClockSegment[] }>;
  readonly tracks: readonly Track[];
  readonly campaigns: readonly Campaign[];
  readonly spots: ReadonlyMap<string, readonly Spot[]>;
  readonly existingItems: readonly RundownItem[];
  readonly context: Omit<SchedulingContext, 'hour'>;
  readonly history: PlayHistory;
}

export interface AutoFillResult {
  readonly items: readonly RundownItem[];
  readonly conflicts: readonly { itemId: string; flags: readonly ConflictFlag[] }[];
}
