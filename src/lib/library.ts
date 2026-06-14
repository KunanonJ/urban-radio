import { useMemo } from 'react';
import { CLOUD_ARTWORK, useCloudLibraryStore } from '@/lib/cloud-library-store';
import { useCatalogAlbums, useCatalogTracks } from '@/lib/catalog-queries';
import type { Album, Track } from '@/lib/types';

function mergeUniqueTracks(lists: Track[][]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const list of lists) {
    for (const t of list) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

/** Cloud uploads only (sync). Use `useMergedTracks` for API catalog when online. */
export function getMergedTracks(): Track[] {
  const cloud = useCloudLibraryStore.getState().tracks;
  return mergeUniqueTracks([cloud]);
}

/** Cloud + `/api/catalog` (deduped by id). Empty when both are empty. */
export function useMergedTracks(): Track[] {
  const cloud = useCloudLibraryStore((s) => s.tracks);
  const { data: apiTracks } = useCatalogTracks();
  return useMemo(
    () => mergeUniqueTracks([cloud, apiTracks ?? []]),
    [cloud, apiTracks]
  );
}

/** D1/API albums + optional “Cloud library” album when uploads exist. Empty when both are empty. */
export function useMergedAlbums(): Album[] {
  const cloudTracks = useCloudLibraryStore((s) => s.tracks);
  const { data: apiAlbums } = useCatalogAlbums();
  return useMemo(() => {
    const base = (apiAlbums ?? []).map((a) => ({ ...a, tracks: [...a.tracks] }));
    if (cloudTracks.length === 0) return base;

    let maxTs = 0;
    for (const t of cloudTracks) {
      const ts = t.dateAdded ? new Date(t.dateAdded).getTime() : 0;
      if (ts > maxTs) maxTs = ts;
    }
    const dateAdded =
      maxTs > 0
        ? new Date(maxTs).toISOString()
        : cloudTracks[0]?.dateAdded ?? new Date().toISOString();

    const cloudAlbum: Album = {
      id: 'cloud-lib',
      title: 'Cloud library',
      artist: 'Upload',
      artistId: 'cloud-upload',
      artwork: CLOUD_ARTWORK,
      year: new Date().getFullYear(),
      genre: 'Upload',
      trackCount: cloudTracks.length,
      tracks: [...cloudTracks],
      source: 'cloud',
      dateAdded,
    };

    return [...base, cloudAlbum];
  }, [cloudTracks, apiAlbums]);
}
