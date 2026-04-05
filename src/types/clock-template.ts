export type SegmentType = 'song' | 'ad_break' | 'jingle' | 'news' | 'talk_break' | 'promo' | 'filler';

export interface ClockSegment {
  readonly id: string;
  readonly type: SegmentType;
  readonly label: string;
  readonly targetDurationSec: number;
  readonly slotCount?: number;
  readonly hardStartAtMin?: number;
  readonly hardEndAtMin?: number;
  readonly rules?: Record<string, unknown>;
  readonly position: number;
}

export interface ClockTemplate {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly daypart?: string;
  readonly timezone: string;
  readonly segments: readonly ClockSegment[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
