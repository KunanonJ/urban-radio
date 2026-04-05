import { z } from 'zod';

export const albumFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(300, 'Title is too long'),
  artistId: z.string().min(1, 'Artist is required'),
  releaseYear: z.coerce
    .number()
    .int()
    .min(1900)
    .max(new Date().getFullYear() + 1)
    .optional(),
  status: z.enum(['active', 'archived']),
});

export type AlbumFormValues = z.infer<typeof albumFormSchema>;
