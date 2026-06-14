import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildCloudTrackFromFile,
  useCloudLibraryStore,
} from '@/lib/cloud-library-store';
import type { Track } from '@/lib/types';

function fileWithName(name: string, size = 1024): File {
  return new File(['x'.repeat(size)], name, { type: 'audio/mpeg' });
}

function track(id: string, hash?: string, title = `t-${id}`): Track {
  return {
    id,
    title,
    artist: 'Upload',
    artistId: 'cloud-upload',
    album: 'Cloud library',
    albumId: 'cloud-lib',
    duration: 0,
    artwork: 'art',
    source: 'cloud',
    genre: 'Upload',
    year: 2026,
    trackNumber: 1,
    contentHash: hash,
  };
}

const fresh = () =>
  useCloudLibraryStore.setState({
    tracks: [],
    sessionMediaUrls: {},
    lastUploadAt: null,
  });

beforeEach(() => {
  fresh();
  vi.stubGlobal('URL', {
    ...globalThis.URL,
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildCloudTrackFromFile', () => {
  test('given file with extension > strips extension from title', () => {
    const t = buildCloudTrackFromFile(
      fileWithName('song.mp3'),
      { id: 'upload-1', key: 'key-1' },
      'track-1',
      'hash-1'
    );
    expect(t.title).toBe('song');
  });

  test('given empty filename base > falls back to placeholder', () => {
    const t = buildCloudTrackFromFile(
      fileWithName('.mp3'),
      { id: 'u', key: 'k' },
      'tid',
      'h'
    );
    expect(t.title).toBe('(untitled)');
  });

  test('given inputs > attaches cloudKey, contentHash, and source', () => {
    const t = buildCloudTrackFromFile(
      fileWithName('a.flac'),
      { id: 'u', key: 'r2-key/a.flac' },
      'tid',
      'sha256-xyz'
    );
    expect(t.cloudKey).toBe('r2-key/a.flac');
    expect(t.contentHash).toBe('sha256-xyz');
    expect(t.source).toBe('cloud');
  });
});

describe('useCloudLibraryStore.addCloudTracks', () => {
  test('given new tracks > adds them and reports count + titles', () => {
    const result = useCloudLibraryStore.getState().addCloudTracks([
      { track: track('1', 'h1', 'A'), blobUrl: 'blob:a' },
      { track: track('2', 'h2', 'B'), blobUrl: 'blob:b' },
    ]);
    expect(result.added).toBe(2);
    expect(result.skippedTitles).toEqual([]);
    expect(result.addedTitles).toEqual(['A', 'B']);
    expect(useCloudLibraryStore.getState().tracks).toHaveLength(2);
  });

  test('given duplicate hash already in store > skips it and reports skippedTitles', () => {
    useCloudLibraryStore.getState().addCloudTracks([
      { track: track('1', 'h1', 'Original'), blobUrl: 'blob:1' },
    ]);
    const result = useCloudLibraryStore.getState().addCloudTracks([
      { track: track('2', 'h1', 'Duplicate'), blobUrl: 'blob:2' },
    ]);
    expect(result.added).toBe(0);
    expect(result.skippedTitles).toEqual(['Duplicate']);
    expect(useCloudLibraryStore.getState().tracks).toHaveLength(1);
  });

  test('given duplicate hash within same batch > only first one is added', () => {
    const result = useCloudLibraryStore.getState().addCloudTracks([
      { track: track('1', 'h1', 'First'), blobUrl: 'blob:1' },
      { track: track('2', 'h1', 'Second'), blobUrl: 'blob:2' },
    ]);
    expect(result.added).toBe(1);
    expect(result.skippedTitles).toEqual(['Second']);
  });

  test('given track with no hash > always added (cannot dedupe)', () => {
    useCloudLibraryStore.getState().addCloudTracks([
      { track: track('1', undefined, 'NoHash1'), blobUrl: 'blob:1' },
    ]);
    const result = useCloudLibraryStore.getState().addCloudTracks([
      { track: track('2', undefined, 'NoHash2'), blobUrl: 'blob:2' },
    ]);
    expect(result.added).toBe(1);
    expect(useCloudLibraryStore.getState().tracks).toHaveLength(2);
  });

  test('given added track > attaches blobUrl as mediaUrl and records sessionMediaUrls', () => {
    useCloudLibraryStore.getState().addCloudTracks([
      { track: track('1', 'h1'), blobUrl: 'blob:abc' },
    ]);
    const state = useCloudLibraryStore.getState();
    expect(state.tracks[0].mediaUrl).toBe('blob:abc');
    expect(state.sessionMediaUrls['1']).toBe('blob:abc');
  });

  test('given any track added > updates lastUploadAt', () => {
    expect(useCloudLibraryStore.getState().lastUploadAt).toBeNull();
    useCloudLibraryStore.getState().addCloudTracks([
      { track: track('1', 'h1'), blobUrl: 'blob:1' },
    ]);
    expect(useCloudLibraryStore.getState().lastUploadAt).not.toBeNull();
  });

  test('given empty input array > lastUploadAt stays null', () => {
    useCloudLibraryStore.getState().addCloudTracks([]);
    expect(useCloudLibraryStore.getState().lastUploadAt).toBeNull();
  });
});

describe('useCloudLibraryStore.removeCloudTrack', () => {
  test('given existing id > removes the track', () => {
    useCloudLibraryStore.getState().addCloudTracks([
      { track: track('1', 'h1'), blobUrl: 'blob:1' },
      { track: track('2', 'h2'), blobUrl: 'blob:2' },
    ]);
    useCloudLibraryStore.getState().removeCloudTrack('1');
    const state = useCloudLibraryStore.getState();
    expect(state.tracks.map((t) => t.id)).toEqual(['2']);
    expect(state.sessionMediaUrls).not.toHaveProperty('1');
  });

  test('given existing id > revokes its object URL', () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { ...globalThis.URL, revokeObjectURL: revoke });
    useCloudLibraryStore.getState().addCloudTracks([
      { track: track('1', 'h1'), blobUrl: 'blob:to-revoke' },
    ]);
    useCloudLibraryStore.getState().removeCloudTrack('1');
    expect(revoke).toHaveBeenCalledWith('blob:to-revoke');
  });

  test('given unknown id > does not throw and leaves tracks intact', () => {
    useCloudLibraryStore.getState().addCloudTracks([
      { track: track('1', 'h1'), blobUrl: 'blob:1' },
    ]);
    expect(() => useCloudLibraryStore.getState().removeCloudTrack('does-not-exist')).not.toThrow();
    expect(useCloudLibraryStore.getState().tracks).toHaveLength(1);
  });
});
