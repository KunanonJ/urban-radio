import { z } from 'zod';

export const advertiserFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email('Invalid email').optional().or(z.literal('')),
  phone: z.string().max(30).optional(),
  industry: z.string().max(100).optional(),
  status: z.enum(['active', 'inactive']),
});

export type AdvertiserFormValues = z.infer<typeof advertiserFormSchema>;
