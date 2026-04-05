import type { RotationCategory, SegmentType, ConflictFlag, UserRole } from '@/types';

export const ROTATION_CATEGORIES: readonly RotationCategory[] = [
  'A', 'B', 'C', 'RECURRENT', 'GOLD', 'INACTIVE',
] as const;

export const SEGMENT_TYPES: readonly SegmentType[] = [
  'song', 'ad_break', 'jingle', 'news', 'talk_break', 'promo', 'filler',
] as const;

export const SEGMENT_TYPE_LABELS: Record<SegmentType, string> = {
  song: 'Song',
  ad_break: 'Ad Break',
  jingle: 'Jingle',
  news: 'News',
  talk_break: 'Talk Break',
  promo: 'Promo',
  filler: 'Filler',
};

export const SEGMENT_TYPE_COLORS: Record<SegmentType, string> = {
  song: 'bg-blue-500',
  ad_break: 'bg-amber-500',
  jingle: 'bg-purple-500',
  news: 'bg-emerald-500',
  talk_break: 'bg-orange-500',
  promo: 'bg-pink-500',
  filler: 'bg-gray-500',
};

export const CONFLICT_SEVERITY: Record<ConflictFlag, 'error' | 'warning'> = {
  NO_VALID_TRACK: 'error',
  NO_VALID_AD: 'warning',
  ARTIST_REPEAT: 'warning',
  ADVERTISER_REPEAT: 'warning',
  HOUR_OVERFLOW: 'error',
  CAMPAIGN_EXPIRED: 'error',
  SPOT_NOT_APPROVED: 'error',
};

export const ROTATION_WEIGHTS: Record<Exclude<RotationCategory, 'INACTIVE'>, number> = {
  A: 4,
  B: 2,
  C: 1,
  RECURRENT: 1.5,
  GOLD: 0.5,
};

export const ROTATION_COOLDOWN_HOURS: Record<RotationCategory, number> = {
  A: 2,
  B: 4,
  C: 8,
  RECURRENT: 12,
  GOLD: 24,
  INACTIVE: Infinity,
};

export const USER_ROLES: readonly UserRole[] = [
  'admin', 'manager', 'librarian', 'traffic', 'operator', 'viewer',
] as const;

export const HOUR_DURATION_SEC = 3600;
export const MAX_ITEMS_PER_PAGE = 50;
