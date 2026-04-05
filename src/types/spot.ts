export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Spot {
  readonly id: string;
  readonly campaignId: string;
  readonly title: string;
  readonly durationSec: number;
  readonly audioStoragePath: string;
  readonly contentHash: string;
  readonly approvalStatus: ApprovalStatus;
  readonly versionLabel?: string;
  readonly scriptText?: string;
  readonly startDateOverride?: string;
  readonly endDateOverride?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
