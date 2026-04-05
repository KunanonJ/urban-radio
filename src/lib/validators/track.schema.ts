import { z } from 'zod';

export const trackFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(300, 'Title is too long'),
  artistId: z.string().min(1, 'Artist is required'),
  albumId: z.string().nullable().optional(),
  genre: z.string().max(100).optional(),
  subgenre: z.string().max(100).optional(),
  mood: z.string().max(100).optional(),
  language: z.string().max(50).optional(),
  bpm: z.coerce.number().int().min(20).max(300).nullable().optional(),
  musicalKey: z.string().max(10).nullable().optional(),
  durationSec: z.coerce.number().min(1, 'Duration is required').max(7200),
  isExplicit: z.boolean(),
  rotationCategory: z.enum(['A', 'B', 'C', 'RECURRENT', 'GOLD', 'INACTIVE']),
  energyLevel: z.coerce.number().int().min(1).max(5).optional() as z.ZodType<1 | 2 | 3 | 4 | 5 | undefined>,
  introSec: z.coerce.number().min(0).max(120).optional(),
  outroSec: z.coerce.number().min(0).max(120).optional(),
  hookSec: z.coerce.number().min(0).max(600).optional(),
  releaseYear: z.coerce
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 1)
    .optional(),
  status: z.enum(['draft', 'active', 'archived']),
});

export type TrackFormValues = z.infer<typeof trackFormSchema>;
