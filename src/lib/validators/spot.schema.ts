import { z } from 'zod';

export const spotFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  durationSec: z.coerce.number().int().min(5).max(120),
  approvalStatus: z.enum(['pending', 'approved', 'rejected']),
  versionLabel: z.string().max(50).optional(),
  scriptText: z.string().max(5000).optional(),
  startDateOverride: z.string().optional(),
  endDateOverride: z.string().optional(),
});

export type SpotFormValues = z.infer<typeof spotFormSchema>;
