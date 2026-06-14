'use client';

import Image from 'next/image';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Pause, Play, SkipForward, Download } from 'lucide-react';

import { useHydrated } from '@/hooks/use-hydrated';
import { usePlayerStore } from '@/lib/store';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';

import { CountdownRing } from './CountdownRing';

export type NowNextQueueLayout = 'compact' | 'wide' | 'minimal';

interface NowNextQueueStripProps {
  /** `compact` (default), `wide` (larger meters/cards), or `minimal` (hide queue list). */
  layout?: NowNextQueueLayout;
  className?: string;
}

/**
 * Three-track strip for the Live Studio: Now / Next / Queue.
 *
 * - Now: artwork + title + artist + CountdownRing + mm:ss / mm:ss; play/pause + skip.
 * - Next: looked up via `usePlayerStore.getNextTrack()`; preload button is a no-op stub
 *   (wired in Phase 3.5 once preloading lands).
 * - Queue: next 5 tracks after "Next" (queue[queueIndex+2..queueIndex+7]); click → playAtQueueIndex.
 *
 * When there is no current track, renders the shared `EmptyState` using the
 * pre-staged `liveStudio.emptyState.*` keys.
 */
export function NowNextQueueStrip({ layout = 'compact', className }: NowNextQueueStripProps) {
  const { t } = useTranslation();
  const hydrated = useHydrated();

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const playAtQueueIndex = usePlayerStore((s) => s.playAtQueueIndex);
  const getNextTrack = usePlayerStore((s) => s.getNextTrack);

  if (!currentTrack) {
    return (
      <div className={cn('w-full', className)} data-testid="live-studio-empty-state">
        <EmptyState
          title={t('liveStudio.emptyState.title')}
          description={t('liveStudio.emptyState.description')}
        />
      </div>
    );
  }

  const safeProgress = hydrated ? progress : 0;
  const elapsedSec = Math.floor(safeProgress * currentTrack.duration);
  const remainingSec = Math.max(0, currentTrack.duration - elapsedSec);
  const remainingLabel = formatDuration(remainingSec);
  const totalLabel = formatDuration(currentTrack.duration);
  const elapsedLabel = formatDuration(elapsedSec);

  const nextTrack = getNextTrack();
  // Queue mini-list starts at queueIndex + 2 (skip current + next-up).
  const queueStart = queueIndex + 2;
  const queueSliceMax = layout === 'minimal' ? 0 : 5;
  const queueSlice = queue.slice(queueStart, queueStart + queueSliceMax);

  const ringSize = layout === 'wide' ? 144 : 112;
  const ringStroke = layout === 'wide' ? 10 : 8;
  const cardPadding = layout === 'wide' ? 'p-6' : 'p-4';
  const gridCols =
    layout === 'minimal'
      ? 'md:grid-cols-2'
      : 'md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]';

  return (
    <div
      className={cn('grid w-full grid-cols-1 gap-3 sm:gap-4', gridCols, className)}
      data-testid="live-studio-strip"
      data-layout={layout}
    >
      {/* ---- NOW ---- */}
      <section
        className={cn(
          'surface-2 flex flex-col gap-4 rounded-xl border border-border',
          cardPadding,
        )}
        data-testid="live-studio-now"
      >
        <header className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('liveStudio.now')}
          </span>
          <span className="text-[11px] font-mono tabular-nums text-muted-foreground">
            {elapsedLabel} / {totalLabel}
          </span>
        </header>

        <div className="flex items-center gap-4">
          <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-md sm:h-24 sm:w-24">
            <Image
              src={currentTrack.artwork}
              alt=""
              fill
              sizes="96px"
              unoptimized
              className="object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold leading-tight sm:text-lg">
              {currentTrack.title}
            </p>
            <p className="truncate text-sm text-muted-foreground">{currentTrack.artist}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {t('liveStudio.remaining')}: <span className="font-mono tabular-nums">{remainingLabel}</span>
            </p>
          </div>
          <div className="hidden sm:block text-primary">
            <CountdownRing progress={safeProgress} size={ringSize} strokeWidth={ringStroke} remainingLabel={remainingLabel} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            onClick={togglePlay}
            data-testid="live-studio-play"
            aria-label={isPlaying ? t('liveStudio.pause') : t('liveStudio.play')}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105"
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
          </motion.button>
          <button
            type="button"
            onClick={next}
            data-testid="live-studio-skip"
            aria-label={t('liveStudio.skip')}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>
      </section>

      {/* ---- NEXT ---- */}
      <section
        className={cn(
          'surface-2 flex flex-col gap-3 rounded-xl border border-border',
          cardPadding,
        )}
        data-testid="live-studio-next"
      >
        <header className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('liveStudio.next')}
          </span>
        </header>

        {nextTrack ? (
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md">
              <Image
                src={nextTrack.artwork}
                alt=""
                fill
                sizes="56px"
                unoptimized
                className="object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">{nextTrack.title}</p>
              <p className="truncate text-xs text-muted-foreground">{nextTrack.artist}</p>
              <p className="text-[11px] font-mono tabular-nums text-muted-foreground">
                {formatDuration(nextTrack.duration)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}

        <button
          type="button"
          // Phase 3.5 hook: this will pre-buffer the next audio element.
          onClick={() => {
            /* preload — no-op until Phase 3.5 */
          }}
          data-testid="live-studio-preload"
          disabled={!nextTrack}
          className="mt-1 inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          {t('liveStudio.preload')}
        </button>
      </section>

      {/* ---- QUEUE ---- */}
      {layout !== 'minimal' ? (
        <section
          className={cn(
            'surface-2 flex flex-col gap-2 rounded-xl border border-border',
            cardPadding,
          )}
          data-testid="live-studio-queue"
        >
          <header className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('liveStudio.queue')}
            </span>
          </header>
          {queueSlice.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <ul className="flex flex-col gap-1" role="list">
              {queueSlice.map((track, i) => {
                const absoluteIndex = queueStart + i;
                return (
                  <li key={`${track.id}-${absoluteIndex}`}>
                    <button
                      type="button"
                      onClick={() => playAtQueueIndex(absoluteIndex)}
                      data-testid={`live-studio-queue-row-${absoluteIndex}`}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary/60"
                    >
                      <span className="w-5 shrink-0 text-[10px] font-mono tabular-nums text-muted-foreground">
                        {absoluteIndex - queueIndex}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{track.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {track.artist}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] font-mono tabular-nums text-muted-foreground">
                        {formatDuration(track.duration)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

export default NowNextQueueStrip;
