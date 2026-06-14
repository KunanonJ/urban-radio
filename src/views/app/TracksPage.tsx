"use client";

import { useCallback, useMemo, useState } from 'react';
import { Music2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { FacetedFilterBar } from '@/components/library/FacetedFilterBar';
import { TrackPreviewPane } from '@/components/library/TrackPreviewPane';
import { VirtualizedTrackTable } from '@/components/library/VirtualizedTrackTable';
import {
  useInfiniteCatalogTracks,
  type TrackQueryFilters,
} from '@/lib/catalog-queries';
import { usePlayerStore } from '@/lib/store';
import type { Track } from '@/lib/types';

const PAGE_SIZE = 50;

export default function TracksPage() {
  const { t } = useTranslation();
  const play = usePlayerStore((s) => s.play);
  const addToQueue = usePlayerStore((s) => s.addToQueue);

  const [filters, setFilters] = useState<TrackQueryFilters>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [hoverTrack, setHoverTrack] = useState<Track | null>(null);

  const query = useInfiniteCatalogTracks(filters, PAGE_SIZE);
  const {
    data,
    isLoading,
    isFetching,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = query;

  const flatTracks = useMemo<Track[]>(
    () => (data ? data.pages.flatMap((p) => p.tracks) : []),
    [data],
  );

  const handlePlayTrack = useCallback(
    (track: Track) => {
      play(track);
    },
    [play],
  );

  const handlePreviewTrack = useCallback((track: Track | null) => {
    setHoverTrack(track);
  }, []);

  const handleNearEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleAddSelectedToQueue = useCallback(() => {
    const ids = [...selected];
    let count = 0;
    for (const id of ids) {
      const tr = flatTracks.find((x) => x.id === id);
      if (tr) {
        addToQueue(tr);
        count++;
      }
    }
    if (count > 0) {
      toast.success(t('tracks.addedToQueue', { count }));
      setSelected(new Set());
    }
  }, [selected, flatTracks, addToQueue, t]);

  const handleUpload = useCallback(() => {
    // Upload dialog wiring lives on the separate Upload screen. Surface a
    // toast so the action chip in the EmptyState gives feedback today.
    toast.message('Upload via /app/upload (UI wired in a separate task).');
  }, []);

  if (isLoading) {
    return (
      <div className="app-page space-y-4">
        <div className="flex items-center gap-3">
          <Music2 className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">{t('tracks.title')}</h1>
        </div>
        <div data-testid="tp-loading" className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="app-page space-y-4">
        <div className="flex items-center gap-3">
          <Music2 className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">{t('tracks.title')}</h1>
        </div>
        <EmptyState
          title="Could not load tracks"
          description="The catalog API is unavailable. Check your connection and try again."
          icon={Music2}
          action={{ label: 'Retry', onClick: () => void refetch() }}
        />
      </div>
    );
  }

  const isEmpty = flatTracks.length === 0;

  return (
    <div className="app-page space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <Music2 className="h-6 w-6 shrink-0 text-primary" />
        <h1 className="text-3xl font-bold text-foreground">{t('tracks.title')}</h1>
        <span className="text-sm text-muted-foreground">
          {t('tracks.count', { count: flatTracks.length })}
        </span>
      </header>

      <FacetedFilterBar
        filters={filters}
        onFilterChange={setFilters}
        totalCount={flatTracks.length}
      />

      {selected.size > 0 && (
        <div
          data-testid="tp-bulk-toolbar"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border surface-2 px-3 py-2"
        >
          <span className="text-sm text-muted-foreground">
            {t('tracks.selectedCount', { count: selected.size })}
          </span>
          <Button
            type="button"
            size="sm"
            onClick={handleAddSelectedToQueue}
            data-testid="tp-bulk-add-to-queue"
          >
            {t('tracks.addToQueue')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            data-testid="tp-bulk-clear"
          >
            {t('tracks.clearSelection')}
          </Button>
        </div>
      )}

      {isEmpty ? (
        <EmptyState
          title={t('emptyStates.tracks.title')}
          description={t('emptyStates.tracks.description')}
          icon={Upload}
          action={{ label: t('emptyStates.tracks.action'), onClick: handleUpload }}
        />
      ) : (
        <div
          data-testid="tp-content"
          className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]"
        >
          <VirtualizedTrackTable
            tracks={flatTracks}
            selected={selected}
            onSelectionChange={setSelected}
            onPlayTrack={handlePlayTrack}
            onPreviewTrack={handlePreviewTrack}
            onNearEnd={handleNearEnd}
          />
          <div className="hidden xl:block">
            <TrackPreviewPane
              track={hoverTrack}
              onPlay={(tr) => play(tr)}
              onAddToQueue={(tr) => addToQueue(tr)}
            />
          </div>
        </div>
      )}

      {isFetchingNextPage && (
        <p data-testid="tp-loading-more" className="text-center text-xs text-muted-foreground">
          Loading more…
        </p>
      )}
      {!isLoading && isFetching && !isFetchingNextPage && (
        <p className="sr-only" aria-live="polite">Refreshing…</p>
      )}
    </div>
  );
}
