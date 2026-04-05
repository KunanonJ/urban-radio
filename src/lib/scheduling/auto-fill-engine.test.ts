import { describe, it, expect } from 'vitest';
import { autoFill } from './auto-fill-engine';
import type { Track } from '@/types/track';
import type { Campaign } from '@/types/campaign';
import type { Spot } from '@/types/spot';
import type { ClockSegment } from '@/types/clock-template';
import type { PlayHistory } from './types';

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Song One',
    normalizedTitle: 'song one',
    artistId: 'artist-1',
    durationSec: 210,
    isExplicit: false,
    rotationCategory: 'A',
    storagePath: '/audio/t1.mp3',
    contentHash: 'hash1',
    status: 'active',
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'camp-1',
    advertiserId: 'adv-1',
    campaignName: 'Test Ad',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    contractedSpots: 100,
    priority: 'normal',
    allowedDays: [0, 1, 2, 3, 4, 5, 6],
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSpot(overrides: Partial<Spot> = {}): Spot {
  return {
    id: 'spot-1',
    campaignId: 'camp-1',
    title: 'Ad Spot 30s',
    durationSec: 30,
    audioStoragePath: '/audio/spot.mp3',
    contentHash: 'shash1',
    approvalStatus: 'approved',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const emptyHistory: PlayHistory = {
  trackPlays: new Map(),
  artistPlays: new Map(),
  advertiserPlays: new Map(),
  campaignPlayCounts: new Map(),
};

const segments: ClockSegment[] = [
  { id: 's1', type: 'song', label: 'Song A', targetDurationSec: 210, position: 0, rules: { rotationCategory: 'A' } },
  { id: 's2', type: 'song', label: 'Song B', targetDurationSec: 210, position: 1, rules: { rotationCategory: 'B' } },
  { id: 's3', type: 'ad_break', label: 'Ad Break', targetDurationSec: 30, slotCount: 1, position: 2 },
  { id: 's4', type: 'jingle', label: 'Station ID', targetDurationSec: 15, position: 3 },
];

describe('autoFill', () => {
  it('fills a single hour with mixed segments', () => {
    const tracks = [
      makeTrack({ id: 't-a', rotationCategory: 'A', artistId: 'ar-1' }),
      makeTrack({ id: 't-b', rotationCategory: 'B', artistId: 'ar-2', durationSec: 210 }),
    ];
    const campaigns = [makeCampaign()];
    const spots = new Map([['camp-1', [makeSpot()]]]);
    const templates = new Map([['tpl-1', { segments }]]);

    const result = autoFill({
      date: '2026-04-05',
      hours: [{ hour: 10, clockTemplateId: 'tpl-1' }],
      templates,
      tracks,
      campaigns,
      spots,
      existingItems: [],
      context: {
        date: '2026-04-05',
        dayOfWeek: 0,
        explicitAllowed: true,
        songRules: { sameArtistMinSlots: 4, sameTrackMinHours: 2 },
        adRules: { defaultMinMinutesBetweenSameAdvertiser: 30 },
      },
      history: emptyHistory,
    });

    expect(result.items).toHaveLength(4);
    expect(result.items[0]?.type).toBe('song');
    expect(result.items[1]?.type).toBe('song');
    expect(result.items[2]?.type).toBe('ad');
    expect(result.items[3]?.type).toBe('jingle');
    expect(result.items[3]?.title).toBe('Station ID');
  });

  it('generates NO_VALID_TRACK when no matching tracks', () => {
    const templates = new Map([['tpl-1', { segments: [segments[0]!] }]]);

    const result = autoFill({
      date: '2026-04-05',
      hours: [{ hour: 10, clockTemplateId: 'tpl-1' }],
      templates,
      tracks: [], // no tracks
      campaigns: [],
      spots: new Map(),
      existingItems: [],
      context: {
        date: '2026-04-05',
        dayOfWeek: 0,
        explicitAllowed: true,
        songRules: { sameArtistMinSlots: 4, sameTrackMinHours: 2 },
        adRules: { defaultMinMinutesBetweenSameAdvertiser: 30 },
      },
      history: emptyHistory,
    });

    expect(result.items[0]?.conflictFlags).toContain('NO_VALID_TRACK');
  });

  it('preserves manually pinned items', () => {
    const tracks = [makeTrack({ id: 't-a', rotationCategory: 'A', artistId: 'ar-1' })];
    const templates = new Map([['tpl-1', { segments: [segments[0]!] }]]);

    const pinnedItem = {
      id: 'pinned-1',
      type: 'song' as const,
      sourceRefId: 't-custom',
      sourceCollection: 'tracks',
      title: 'Custom Pick',
      artistName: 'ar-custom',
      durationSec: 210,
      scheduledStart: '10:00:00',
      scheduledEnd: '10:03:30',
      hourBlock: 10,
      position: 0,
      isManualOverride: true,
      conflictFlags: [] as const,
      status: 'scheduled' as const,
    };

    const result = autoFill({
      date: '2026-04-05',
      hours: [{ hour: 10, clockTemplateId: 'tpl-1' }],
      templates,
      tracks,
      campaigns: [],
      spots: new Map(),
      existingItems: [pinnedItem],
      context: {
        date: '2026-04-05',
        dayOfWeek: 0,
        explicitAllowed: true,
        songRules: { sameArtistMinSlots: 4, sameTrackMinHours: 2 },
        adRules: { defaultMinMinutesBetweenSameAdvertiser: 30 },
      },
      history: emptyHistory,
    });

    // Pinned item should be preserved
    expect(result.items.some((i) => i.id === 'pinned-1')).toBe(true);
  });

  it('fills multiple hours', () => {
    const tracks = [
      makeTrack({ id: 't-1', rotationCategory: 'A', artistId: 'ar-1' }),
      makeTrack({ id: 't-2', rotationCategory: 'B', artistId: 'ar-2', durationSec: 210 }),
    ];
    const singleSongSegments: ClockSegment[] = [
      { id: 's1', type: 'song', label: 'Song', targetDurationSec: 210, position: 0 },
    ];
    const templates = new Map([['tpl-1', { segments: singleSongSegments }]]);

    const result = autoFill({
      date: '2026-04-05',
      hours: [
        { hour: 10, clockTemplateId: 'tpl-1' },
        { hour: 11, clockTemplateId: 'tpl-1' },
      ],
      templates,
      tracks,
      campaigns: [],
      spots: new Map(),
      existingItems: [],
      context: {
        date: '2026-04-05',
        dayOfWeek: 0,
        explicitAllowed: true,
        songRules: { sameArtistMinSlots: 4, sameTrackMinHours: 2 },
        adRules: { defaultMinMinutesBetweenSameAdvertiser: 30 },
      },
      history: emptyHistory,
    });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.hourBlock).toBe(10);
    expect(result.items[1]?.hourBlock).toBe(11);
  });
});
