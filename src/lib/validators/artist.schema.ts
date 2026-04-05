import { z } from 'zod';

export const artistFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200, 'Name is too long'),
  country: z.string().max(100).optional(),
  status: z.enum(['active', 'archived']),
});

export type ArtistFormValues = z.infer<typeof artistFormSchema>;
