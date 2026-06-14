import { useMemo } from 'react';
import { useMergedTracks } from '@/lib/library';
import { useSpotScheduleStore } from '@/lib/spot-schedule-store';
import { buildSearchHits, type SearchHit } from '@/lib/search-hits';

export function useSearchResults(query: string): SearchHit[] {
  const tracks = useMergedTracks();
  const rules = useSpotScheduleStore((s) => s.rules);
  return useMemo(() => buildSearchHits(query, tracks, rules), [query, tracks, rules]);
}
