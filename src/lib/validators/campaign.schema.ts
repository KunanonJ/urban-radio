import { z } from 'zod';

export const campaignFormSchema = z
  .object({
    advertiserId: z.string().min(1, 'Advertiser is required'),
    campaignName: z.string().min(1, 'Campaign name is required').max(300),
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    contractedSpots: z.coerce.number().int().min(1, 'At least 1 spot required'),
    priority: z.enum(['low', 'normal', 'high', 'guaranteed']),
    allowedDays: z.array(z.number().int().min(0).max(6)).min(1, 'Select at least one day'),
    allowedStartTime: z.string().optional(),
    allowedEndTime: z.string().optional(),
    maxPlaysPerHour: z.coerce.number().int().min(1).optional(),
    minMinutesBetweenRepeats: z.coerce.number().int().min(0).optional(),
    status: z.enum(['draft', 'active', 'paused', 'completed', 'expired']),
    notes: z.string().max(2000).optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

export type CampaignFormValues = z.infer<typeof campaignFormSchema>;
