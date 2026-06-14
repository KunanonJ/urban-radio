import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track } from '@/lib/types';

export const CLOUD_ARTWORK =
  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop';

function stripMediaUrl(t: Track): Track {
  const { mediaUrl: _mediaUrl, ...rest } = t;
  return rest;
}

export function buildCloudTrackFromFile(
  file: File,
  upload: { id: string; key: string },
  trackId: string,
  contentHash: string
): Track {
  const withoutExt = file.name.replace(/\.[^.]+$/, '');
  const title = withoutExt || '(untitled)';

  const added = new Date().toISOString();
  return {
    id: trackId,
    title,
    artist: 'Upload',
    artistId: 'cloud-upload',
    album: 'Cloud library',
    albumId: 'cloud-lib',
    duration: 0,
    artwork: CLOUD_ARTWORK,
    source: 'cloud',
    genre: 'Upload',
    year: new Date().getFullYear(),
    trackNumber: 1,
    cloudKey: upload.key,
    contentHash,
    dateAdded: added,
  };
}

interface CloudLibraryState {
  tracks: Track[];
  sessionMediaUrls: Record<string, string>;
  lastUploadAt: string | null;
  /** Skips tracks whose contentHash matches the library or earlier items in the same batch. */
  addCloudTracks: (items: { track: Track; blobUrl: string }[]) => {
    added: number;
    skippedTitles: string[];
    addedTitles: string[];
  };
  removeCloudTrack: (id: string) => void;
}

export const useCloudLibraryStore = create<CloudLibraryState>()(
  persist(
    (set, get) => ({
      tracks: [],
      sessionMediaUrls: {},
      lastUploadAt: null,

      addCloudTracks: (items) => {
        const skippedTitles: string[] = [];
        const seen = new Set(
          get()
            .tracks.map((t) => t.contentHash)
            .filter((h): h is string => Boolean(h))
        );
        const toApply: { track: Track; blobUrl: string }[] = [];
        for (const item of items) {
          const h = item.track.contentHash;
          if (h && seen.has(h)) {
            skippedTitles.push(item.track.title);
            continue;
          }
          if (h) seen.add(h);
          toApply.push(item);
        }

        set((s) => {
          const sessionMediaUrls = { ...s.sessionMediaUrls };
          const nextTracks = [...s.tracks];
          for (const { track, blobUrl } of toApply) {
            sessionMediaUrls[track.id] = blobUrl;
            nextTracks.push({ ...track, mediaUrl: blobUrl });
          }
          return {
            tracks: nextTracks,
            sessionMediaUrls,
            lastUploadAt: toApply.length > 0 ? new Date().toISOString() : s.lastUploadAt,
          };
        });

        return {
          added: toApply.length,
          skippedTitles,
          addedTitles: toApply.map((x) => x.track.title),
        };
      },

      removeCloudTrack: (id) =>
        set((s) => {
          const url = s.sessionMediaUrls[id];
          if (url) URL.revokeObjectURL(url);
          const { [id]: _removed, ...restUrls } = s.sessionMediaUrls;
          return {
            tracks: s.tracks.filter((t) => t.id !== id),
            sessionMediaUrls: restUrls,
          };
        }),
    }),
    {
      name: 'sonic-bloom-cloud-library',
      partialize: (state) => ({
        tracks: state.tracks.map(stripMediaUrl),
        lastUploadAt: state.lastUploadAt,
      }),
    }
  )
);
