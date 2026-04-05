export type CampaignPriority = 'low' | 'normal' | 'high' | 'guaranteed';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'expired';

export interface Campaign {
  readonly id: string;
  readonly advertiserId: string;
  readonly campaignName: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly contractedSpots: number;
  readonly priority: CampaignPriority;
  readonly allowedDays: number[];
  readonly allowedStartTime?: string;
  readonly allowedEndTime?: string;
  readonly maxPlaysPerHour?: number;
  readonly minMinutesBetweenRepeats?: number;
  readonly targetDayparts?: string[];
  readonly status: CampaignStatus;
  readonly notes?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
