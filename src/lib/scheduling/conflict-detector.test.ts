import { describe, it, expect } from 'vitest';
import { detectConflicts } from './conflict-detector';
import type { RundownItem } from '@/types/rundown';

function makeItem(overrides: Partial<RundownItem> = {}): RundownItem {
  return {
    id: 'item-1',
    type: 'song',
    sourceRefId: 'track-1',
    title: 'Test Song',
    durationSec: 210,
    scheduledStart: '10:00:00',
    scheduledEnd: '10:03:30',
    hourBlock: 10,
    position: 0,
    isManualOverride: false,
    conflictFlags: [],
    status: 'scheduled',
    ...overrides,
  };
}

describe('detectConflicts', () => {
  it('returns empty array for valid items', () => {
    const items = [makeItem()];
    const flags = detectConflicts(items, 10);
    expect(flags).toHaveLength(0);
  });

  it('detects HOUR_OVERFLOW when total duration exceeds 3600s', () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeItem({ id: `item-${i}`, position: i, durationSec: 200 }),
    );
    // 20 * 200 = 4000s > 3600s
    const flags = detectConflicts(items, 10);
    expect(flags.some((f) => f.flag === 'HOUR_OVERFLOW')).toBe(true);
  });

  it('detects ARTIST_REPEAT for same artist too close', () => {
    const items = [
      makeItem({ id: 'i-1', position: 0, artistName: 'Artist A', sourceRefId: 'track-1' }),
      makeItem({ id: 'i-2', position: 1, artistName: 'Artist A', sourceRefId: 'track-2' }),
    ];
    const flags = detectConflicts(items, 10, { sameArtistMinSlots: 4 });
    expect(flags.some((f) => f.flag === 'ARTIST_REPEAT')).toBe(true);
  });

  it('does not flag ARTIST_REPEAT when artists are far enough apart', () => {
    const items = [
      makeItem({ id: 'i-1', position: 0, artistName: 'Artist A' }),
      makeItem({ id: 'i-2', position: 1, artistName: 'Artist B' }),
      makeItem({ id: 'i-3', position: 2, artistName: 'Artist C' }),
      makeItem({ id: 'i-4', position: 3, artistName: 'Artist D' }),
      makeItem({ id: 'i-5', position: 4, artistName: 'Artist A' }),
    ];
    const flags = detectConflicts(items, 10, { sameArtistMinSlots: 4 });
    expect(flags.some((f) => f.flag === 'ARTIST_REPEAT')).toBe(false);
  });

  it('detects ADVERTISER_REPEAT for same advertiser too close', () => {
    const items = [
      makeItem({ id: 'i-1', position: 0, type: 'ad', advertiserName: 'Acme' }),
      makeItem({ id: 'i-2', position: 1, type: 'ad', advertiserName: 'Acme' }),
    ];
    const flags = detectConflicts(items, 10);
    expect(flags.some((f) => f.flag === 'ADVERTISER_REPEAT')).toBe(true);
  });

  it('detects SPOT_NOT_APPROVED (flagged items passed in)', () => {
    const items = [
      makeItem({ id: 'i-1', conflictFlags: ['SPOT_NOT_APPROVED'] }),
    ];
    const flags = detectConflicts(items, 10);
    expect(flags.some((f) => f.flag === 'SPOT_NOT_APPROVED')).toBe(true);
  });

  it('detects CAMPAIGN_EXPIRED (flagged items passed in)', () => {
    const items = [
      makeItem({ id: 'i-1', conflictFlags: ['CAMPAIGN_EXPIRED'] }),
    ];
    const flags = detectConflicts(items, 10);
    expect(flags.some((f) => f.flag === 'CAMPAIGN_EXPIRED')).toBe(true);
  });

  it('detects NO_VALID_TRACK for empty song slots', () => {
    const items = [
      makeItem({ id: 'i-1', conflictFlags: ['NO_VALID_TRACK'] }),
    ];
    const flags = detectConflicts(items, 10);
    expect(flags.some((f) => f.flag === 'NO_VALID_TRACK')).toBe(true);
  });
});
