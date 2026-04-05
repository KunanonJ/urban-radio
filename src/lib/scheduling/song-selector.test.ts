import { describe, it, expect } from 'vitest';
import { selectSong } from './song-selector';
import type { Track } from '@/types/track';
import type { ClockSegment } from '@/types/clock-template';
import type { SchedulingContext, PlayHistory } from './types';

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Test Song',
    normalizedTitle: 'test song',
    artistId: 'artist-1',
    durationSec: 210,
    isExplicit: false,
    rotationCategory: 'A',
    storagePath: '/audio/test.mp3',
    contentHash: 'abc123',
    status: 'active',
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSongSegment(overrides: Partial<ClockSegment> = {}): ClockSegment {
  return {
    id: 'seg-1',
    type: 'song',
    label: 'Song A',
    targetDurationSec: 210,
    position: 0,
    ...overrides,
  };
}

const defaultContext: SchedulingContext = {
  date: '2026-04-05',
  hour: 10,
  dayOfWeek: 0,
  explicitAllowed: true,
  songRules: { sameArtistMinSlots: 4, sameTrackMinHours: 2 },
  adRules: { defaultMinMinutesBetweenSameAdvertiser: 30 },
};

const emptyHistory: PlayHistory = {
  trackPlays: new Map(),
  artistPlays: new Map(),
  advertiserPlays: new Map(),
  campaignPlayCounts: new Map(),
};

describe('selectSong', () => {
  it('selects a track when one valid option exists', () => {
    const tracks = [makeTrack()];
    const result = selectSong({
      segment: makeSongSegment(),
      tracks,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.track).not.toBeNull();
    expect(result.track?.id).toBe('track-1');
    expect(result.conflicts).toHaveLength(0);
  });

  it('returns NO_VALID_TRACK when no tracks available', () => {
    const result = selectSong({
      segment: makeSongSegment(),
      tracks: [],
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.track).toBeNull();
    expect(result.conflicts).toContain('NO_VALID_TRACK');
  });

  it('filters out inactive tracks', () => {
    const tracks = [makeTrack({ id: 'inactive', status: 'archived' })];
    const result = selectSong({
      segment: makeSongSegment(),
      tracks,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.track).toBeNull();
    expect(result.conflicts).toContain('NO_VALID_TRACK');
  });

  it('respects rotation category from segment rules', () => {
    const tracks = [
      makeTrack({ id: 't-a', rotationCategory: 'A' }),
      makeTrack({ id: 't-b', rotationCategory: 'B' }),
    ];
    const segment = makeSongSegment({ rules: { rotationCategory: 'B' } });
    const result = selectSong({
      segment,
      tracks,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.track?.id).toBe('t-b');
  });

  it('filters explicit content when not allowed', () => {
    const tracks = [makeTrack({ isExplicit: true })];
    const ctx = { ...defaultContext, explicitAllowed: false };
    const result = selectSong({
      segment: makeSongSegment(),
      tracks,
      context: ctx,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.track).toBeNull();
  });

  it('respects track cooldown based on rotation', () => {
    const tracks = [makeTrack({ id: 't-1', rotationCategory: 'A' })];
    // A rotation = 2h cooldown, played 1h ago -> should be filtered
    const now = new Date('2026-04-05T10:00:00Z');
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const history: PlayHistory = {
      ...emptyHistory,
      trackPlays: new Map([['t-1', [oneHourAgo]]]),
    };
    const result = selectSong({
      segment: makeSongSegment(),
      tracks,
      context: defaultContext,
      history,
      currentHourItems: [],
    });
    expect(result.track).toBeNull();
  });

  it('allows track after cooldown expires', () => {
    const tracks = [makeTrack({ id: 't-1', rotationCategory: 'A' })];
    // A rotation = 2h cooldown, played 3h ago -> should be allowed
    const now = new Date('2026-04-05T10:00:00Z');
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
    const history: PlayHistory = {
      ...emptyHistory,
      trackPlays: new Map([['t-1', [threeHoursAgo]]]),
    };
    const result = selectSong({
      segment: makeSongSegment(),
      tracks,
      context: defaultContext,
      history,
      currentHourItems: [],
    });
    expect(result.track).not.toBeNull();
  });

  it('enforces artist separation within current hour', () => {
    const tracks = [
      makeTrack({ id: 't-1', artistId: 'artist-1' }),
      makeTrack({ id: 't-2', artistId: 'artist-2' }),
    ];
    // artist-1 is already in current hour items at position 0
    const currentHourItems = [
      {
        id: 'item-1',
        type: 'song' as const,
        sourceRefId: 't-1',
        sourceCollection: 'tracks',
        title: 'Existing Song',
        artistName: 'artist-1',
        durationSec: 210,
        scheduledStart: '10:00',
        scheduledEnd: '10:03:30',
        hourBlock: 10,
        position: 0,
        isManualOverride: false,
        conflictFlags: [],
        status: 'scheduled' as const,
      },
    ];
    // With sameArtistMinSlots=4, artist-1 should not appear at position 1
    const segment = makeSongSegment({ position: 1 });
    const result = selectSong({
      segment,
      tracks,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems,
    });
    expect(result.track?.artistId).toBe('artist-2');
  });

  it('respects duration tolerance', () => {
    const tracks = [
      makeTrack({ id: 't-short', durationSec: 100 }),
      makeTrack({ id: 't-fit', durationSec: 220 }),
    ];
    // Segment wants 210s, tolerance is ±15s, so 100s is too short, 220s is within range
    const result = selectSong({
      segment: makeSongSegment({ targetDurationSec: 210 }),
      tracks,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.track?.id).toBe('t-fit');
  });

  it('prefers higher-weighted rotation categories', () => {
    // With many selections, A tracks (weight 4) should appear more than C tracks (weight 1)
    const trackA = makeTrack({ id: 't-a', rotationCategory: 'A', durationSec: 210 });
    const trackC = makeTrack({ id: 't-c', rotationCategory: 'C', durationSec: 210, artistId: 'artist-2' });
    const tracks = [trackA, trackC];

    let aCount = 0;
    const runs = 100;
    for (let i = 0; i < runs; i++) {
      const result = selectSong({
        segment: makeSongSegment(),
        tracks,
        context: defaultContext,
        history: emptyHistory,
        currentHourItems: [],
      });
      if (result.track?.id === 't-a') aCount++;
    }
    // A (weight 4) vs C (weight 1) -> A should get ~80% of selections
    expect(aCount).toBeGreaterThan(50);
  });

  it('does not select INACTIVE rotation tracks', () => {
    const tracks = [makeTrack({ rotationCategory: 'INACTIVE' })];
    const result = selectSong({
      segment: makeSongSegment(),
      tracks,
      context: defaultContext,
      history: emptyHistory,
      currentHourItems: [],
    });
    expect(result.track).toBeNull();
  });
});
