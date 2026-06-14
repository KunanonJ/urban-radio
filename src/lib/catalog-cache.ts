import type { Track } from '@/lib/types';

/** In-memory API catalog for sync resolvers (e.g. resolveTrackById). Updated when catalog fetch succeeds. */
let apiTracks: Track[] = [];

export function setApiCatalogTracks(tracks: Track[]): void {
  apiTracks = tracks;
}

export function getApiCatalogTracks(): Track[] {
  return apiTracks;
}
