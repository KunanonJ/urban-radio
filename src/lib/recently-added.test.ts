import { describe, expect, it } from 'vitest';
import { bucketForDateAdded, groupAlbumsByRecentBucket } from '@/lib/recently-added';
import type { Album } from '@/lib/types';

/** April 8, 2026 Wed afternoon (local) — week contains Apr 5–7 between month start and today. */
const now = new Date(2026, 3, 8, 15, 0, 0);

function albumWithDate(iso: string, id: string): Album {
  return {
    id,
    title: 'T',
    artist: 'A',
    artistId: 'a1',
    artwork: '',
    year: 2026,
    genre: 'X',
    trackCount: 1,
    tracks: [],
    source: 'local',
    dateAdded: iso,
  };
}

describe('bucketForDateAdded', () => {
  it('puts calendar yesterday in yesterday', () => {
    const d = new Date(2026, 3, 7, 10, 0, 0);
    expect(bucketForDateAdded(d, now)).toBe('yesterday');
  });

  it('puts earlier this week (not yesterday) in thisWeek', () => {
    const d = new Date(2026, 3, 6, 10, 0, 0);
    expect(bucketForDateAdded(d, now)).toBe('thisWeek');
  });

  it('puts same month but before start of week in thisMonth', () => {
    const d = new Date(2026, 3, 2, 10, 0, 0);
    expect(bucketForDateAdded(d, now)).toBe('thisMonth');
  });

  it('puts previous month in earlier', () => {
    const d = new Date(2026, 2, 15, 10, 0, 0);
    expect(bucketForDateAdded(d, now)).toBe('earlier');
  });

  it('treats future timestamps like now for bucketing', () => {
    const future = new Date(2027, 0, 1, 12, 0, 0);
    expect(bucketForDateAdded(future, now)).toBe(bucketForDateAdded(new Date(now), now));
  });
});

describe('groupAlbumsByRecentBucket', () => {
  it('sorts newest first within a bucket', () => {
    const albums: Album[] = [
      albumWithDate(new Date(2026, 3, 7, 8, 0, 0).toISOString(), 'a'),
      albumWithDate(new Date(2026, 3, 7, 18, 0, 0).toISOString(), 'b'),
    ];
    const g = groupAlbumsByRecentBucket(albums, now);
    expect(g.yesterday.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('sends albums without dateAdded to earlier', () => {
    const a: Album = {
      id: 'x',
      title: 'T',
      artist: 'A',
      artistId: 'a1',
      artwork: '',
      year: 2026,
      genre: 'X',
      trackCount: 1,
      tracks: [],
      source: 'local',
    };
    const g = groupAlbumsByRecentBucket([a], now);
    expect(g.earlier).toHaveLength(1);
  });
});
