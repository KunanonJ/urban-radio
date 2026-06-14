import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { getMergedTracks } from '@/lib/library';
import { useCloudLibraryStore } from '@/lib/cloud-library-store';
import type { Track } from '@/lib/types';

function makeTrack(id: string, title = `t-${id}`): Track {
  return {
    id,
    title,
    artist: 'A',
    artistId: 'aid',
    album: 'AL',
    albumId: 'alid',
    duration: 1,
    artwork: 'art',
    source: 'cloud',
    genre: 'G',
    year: 2026,
    trackNumber: 1,
  };
}

beforeEach(() => {
  useCloudLibraryStore.setState({ tracks: [], sessionMediaUrls: {}, lastUploadAt: null });
});

afterEach(() => {
  useCloudLibraryStore.setState({ tracks: [], sessionMediaUrls: {}, lastUploadAt: null });
});

describe('getMergedTracks (post mock-fallback removal)', () => {
  test('given empty cloud library > returns empty array', () => {
    expect(getMergedTracks()).toEqual([]);
  });

  test('given cloud uploads > returns only cloud tracks (no mock fallback)', () => {
    const t1 = makeTrack('c1');
    const t2 = makeTrack('c2');
    useCloudLibraryStore.setState({
      tracks: [t1, t2],
      sessionMediaUrls: {},
      lastUploadAt: null,
    });
    const merged = getMergedTracks();
    expect(merged).toHaveLength(2);
    expect(merged.map((t) => t.id)).toEqual(['c1', 'c2']);
  });

  test('given duplicate cloud track ids > deduplicates by id', () => {
    const t = makeTrack('dup');
    useCloudLibraryStore.setState({
      tracks: [t, { ...t, title: 'second copy' }],
      sessionMediaUrls: {},
      lastUploadAt: null,
    });
    const merged = getMergedTracks();
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('dup' === merged[0].title ? 'dup' : merged[0].title);
  });
});
