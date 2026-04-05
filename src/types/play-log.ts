import type { RundownItemType } from './rundown';

export type PlayResult = 'played' | 'skipped' | 'partial';

export interface PlayLog {
  readonly id: string;
  readonly rundownId: string;
  readonly rundownItemId: string;
  readonly sourceRefId?: string;
  readonly itemType: RundownItemType;
  readonly playedAt: Date;
  readonly playedBy?: string;
  readonly result: PlayResult;
}
