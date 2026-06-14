import { getApiCatalogTracks } from '@/lib/catalog-cache';
import { useCloudLibraryStore } from '@/lib/cloud-library-store';
import type { Track } from '@/lib/types';

/** Resolve a track by id from API catalog + cloud uploads (sync; first match wins). */
export function resolveTrackById(id: string): Track | null {
  const cloud = useCloudLibraryStore.getState().tracks;
  const api = getApiCatalogTracks();
  const merged = [...api, ...cloud];
  return merged.find((t) => t.id === id) ?? null;
}
