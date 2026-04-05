export type AdvertiserStatus = 'active' | 'inactive';

export interface Advertiser {
  readonly id: string;
  readonly name: string;
  readonly contactName?: string;
  readonly contactEmail?: string;
  readonly phone?: string;
  readonly industry?: string;
  readonly status: AdvertiserStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
