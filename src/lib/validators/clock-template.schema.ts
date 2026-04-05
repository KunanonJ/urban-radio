import { z } from 'zod';

export const SEGMENT_TYPES = [
  'song',
  'ad_break',
  'jingle',
  'news',
  'talk_break',
  'promo',
  'filler',
] as const;

export const segmentFormSchema = z.object({
  id: z.string().min(1),
  type: z.enum(SEGMENT_TYPES),
  label: z.string().min(1, 'Label is required').max(100),
  targetDurationSec: z.coerce.number().int().min(1, 'Duration must be at least 1s').max(3600),
  slotCount: z.coerce.number().int().min(1).optional(),
  rotationCategory: z.enum(['A', 'B', 'C', 'RECURRENT', 'GOLD']).optional(),
  hardStartAtMin: z.coerce.number().int().min(0).max(59).optional(),
  hardEndAtMin: z.coerce.number().int().min(0).max(59).optional(),
  position: z.coerce.number().int().min(0),
});

export type SegmentFormValues = z.infer<typeof segmentFormSchema>;

export const clockTemplateFormSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(200),
  description: z.string().max(500).optional(),
  daypart: z.string().max(50).optional(),
  timezone: z.string().min(1, 'Timezone is required'),
});

export type ClockTemplateFormValues = z.infer<typeof clockTemplateFormSchema>;

/** Sum of all segment durations */
export function totalSegmentDuration(segments: readonly { targetDurationSec: number }[]): number {
  return segments.reduce((sum, s) => sum + s.targetDurationSec, 0);
}

/** Returns null if valid, or a message if there's a duration problem */
export function validateHourDuration(
  totalSec: number,
): { level: 'warning' | 'error'; message: string } | null {
  if (totalSec > 3600) {
    return { level: 'error', message: `Total duration (${totalSec}s) exceeds 3600s by ${totalSec - 3600}s` };
  }
  if (totalSec !== 3600) {
    return { level: 'warning', message: `Total duration is ${totalSec}s (${3600 - totalSec}s short of 3600s)` };
  }
  return null;
}
