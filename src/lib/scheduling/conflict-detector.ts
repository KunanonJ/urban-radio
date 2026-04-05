import type { RundownItem, ConflictFlag } from '@/types/rundown';

export interface ConflictEntry {
  readonly itemId: string;
  readonly flag: ConflictFlag;
  readonly message: string;
}

interface SeparationRules {
  readonly sameArtistMinSlots?: number;
}

const MAX_HOUR_DURATION_SEC = 3600;
const DEFAULT_ADVERTISER_MIN_SLOTS = 2;

/**
 * Pure function: scans a list of rundown items for an hour and returns all conflicts.
 */
export function detectConflicts(
  items: readonly RundownItem[],
  hour: number,
  rules?: SeparationRules,
): ConflictEntry[] {
  const conflicts: ConflictEntry[] = [];

  // Propagate existing conflict flags from items
  for (const item of items) {
    for (const flag of item.conflictFlags) {
      conflicts.push({ itemId: item.id, flag, message: `Pre-existing conflict: ${flag}` });
    }
  }

  // HOUR_OVERFLOW
  const totalDuration = items.reduce((sum, item) => sum + item.durationSec, 0);
  if (totalDuration > MAX_HOUR_DURATION_SEC) {
    conflicts.push({
      itemId: `hour-${hour}`,
      flag: 'HOUR_OVERFLOW',
      message: `Hour ${hour} total duration ${totalDuration}s exceeds ${MAX_HOUR_DURATION_SEC}s`,
    });
  }

  // ARTIST_REPEAT
  const sameArtistMinSlots = rules?.sameArtistMinSlots ?? 4;
  const songItems = items
    .filter((item) => item.type === 'song' && item.artistName)
    .sort((a, b) => a.position - b.position);

  for (let i = 0; i < songItems.length; i++) {
    for (let j = i + 1; j < songItems.length; j++) {
      const itemA = songItems[i]!;
      const itemB = songItems[j]!;
      const distance = Math.abs(itemA.position - itemB.position);
      if (distance < sameArtistMinSlots && itemA.artistName === itemB.artistName) {
        conflicts.push({
          itemId: itemB.id,
          flag: 'ARTIST_REPEAT',
          message: `"${itemB.artistName}" appears at positions ${itemA.position} and ${itemB.position} (min separation: ${sameArtistMinSlots})`,
        });
      }
    }
  }

  // ADVERTISER_REPEAT
  const adItems = items
    .filter((item) => item.type === 'ad' && item.advertiserName)
    .sort((a, b) => a.position - b.position);

  for (let i = 0; i < adItems.length; i++) {
    for (let j = i + 1; j < adItems.length; j++) {
      const itemA = adItems[i]!;
      const itemB = adItems[j]!;
      const distance = Math.abs(itemA.position - itemB.position);
      if (distance < DEFAULT_ADVERTISER_MIN_SLOTS && itemA.advertiserName === itemB.advertiserName) {
        conflicts.push({
          itemId: itemB.id,
          flag: 'ADVERTISER_REPEAT',
          message: `Advertiser "${itemB.advertiserName}" appears at positions ${itemA.position} and ${itemB.position}`,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Checks if any conflicts are blocking (ERROR severity).
 */
export function hasBlockingConflicts(conflicts: readonly ConflictEntry[]): boolean {
  const blocking: ConflictFlag[] = [
    'NO_VALID_TRACK',
    'HOUR_OVERFLOW',
    'CAMPAIGN_EXPIRED',
    'SPOT_NOT_APPROVED',
  ];
  return conflicts.some((c) => blocking.includes(c.flag));
}
