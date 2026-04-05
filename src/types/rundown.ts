export type RundownStatus = 'draft' | 'published' | 'locked';

export type RundownItemType = 'song' | 'ad' | 'jingle' | 'news' | 'talk_break' | 'promo' | 'filler';

export type RundownItemStatus = 'scheduled' | 'played' | 'skipped' | 'replaced';

export type ConflictFlag =
  | 'NO_VALID_TRACK'
  | 'NO_VALID_AD'
  | 'ARTIST_REPEAT'
  | 'ADVERTISER_REPEAT'
  | 'HOUR_OVERFLOW'
  | 'CAMPAIGN_EXPIRED'
  | 'SPOT_NOT_APPROVED';

export interface RundownHour {
  readonly hour: number;
  readonly clockTemplateId?: string;
}

export interface RundownItem {
  readonly id: string;
  readonly type: RundownItemType;
  readonly sourceRefId?: string;
  readonly sourceCollection?: string;
  readonly title: string;
  readonly artistName?: string;
  readonly advertiserName?: string;
  readonly durationSec: number;
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
  readonly hourBlock: number;
  readonly position: number;
  readonly isManualOverride: boolean;
  readonly conflictFlags: readonly ConflictFlag[];
  readonly status: RundownItemStatus;
}

export interface Rundown {
  readonly id: string;
  readonly date: string;
  readonly stationId: string;
  readonly timezone: string;
  readonly status: RundownStatus;
  readonly hours: readonly RundownHour[];
  readonly items: readonly RundownItem[];
  readonly generatedAt?: Date;
  readonly generatedBy?: string;
  readonly publishedAt?: Date;
  readonly publishedBy?: string;
  readonly updatedAt: Date;
}
