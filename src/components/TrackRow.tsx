'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import { Track } from '@/lib/types';
import { formatDuration } from '@/lib/format';
import { isPlaybackEnded, usePlayerStore } from '@/lib/store';
import { Play, Pause } from 'lucide-react';
import { motion } from 'framer-motion';
import { TrackActionsMenu } from '@/components/track/TrackActionsMenu';

interface TrackRowProps {
  track: Track;
  index: number;
  /** Actual index in the playback queue when this row represents queued content. */
  queuePosition?: number;
  /** Prepended column (e.g. drag handle for queue reorder) */
  leadingSlot?: ReactNode;
  showAlbum?: boolean;
  /** Queue page: wall-clock start (e.g. "2:34 PM") */
  startsAtClock?: string;
  /** Queue page: relative delay (e.g. "in 4:12") */
  startsIn?: string;
  /** Library bulk-select mode */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (trackId: string) => void;
}

export function TrackRow({
  track,
  index,
  queuePosition,
  leadingSlot,
  showAlbum = true,
  startsAtClock,
  startsIn,
  selectionMode,
  selected,
  onToggleSelect,
}: TrackRowProps) {
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const play = usePlayerStore((s) => s.play);
  const playAtQueueIndex = usePlayerStore((s) => s.playAtQueueIndex);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const isActive = queuePosition != null ? queueIndex === queuePosition : currentTrackId === track.id;
  const showActions = !selectionMode;
  const startTrack = () => {
    if (queuePosition != null) {
      playAtQueueIndex(queuePosition);
      return;
    }
    play(track);
  };
  const handlePlayButtonClick = () => {
    if (isActive) {
      togglePlay();
      return;
    }
    startTrack();
  };
  const handleRowDoubleClick = () => {
    if (selectionMode) return;
    if (isActive) {
      if (isPlaybackEnded(progress)) {
        startTrack();
      } else {
        play();
      }
      return;
    }
    startTrack();
  };
  const handleRowClick = () => {
    if (selectionMode) return;
    if (isActive) {
      if (isPlaybackEnded(progress)) {
        startTrack();
      } else {
        play();
      }
      return;
    }
    startTrack();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.02 }}
      data-testid="track-row"
      data-active={isActive ? "true" : "false"}
      className={`group flex items-center gap-4 px-4 py-2.5 rounded-lg transition-colors ${selectionMode ? 'cursor-default' : 'cursor-pointer'} ${isActive ? 'bg-primary/10' : 'hover:bg-secondary'} ${selected ? 'ring-1 ring-primary/50 bg-primary/5' : ''} ${leadingSlot ? 'pl-2' : ''}`}
      onClick={handleRowClick}
      onDoubleClick={handleRowDoubleClick}
    >
      {leadingSlot != null && <div className="flex w-8 shrink-0 items-center justify-center">{leadingSlot}</div>}
      <div className="w-8 text-center flex-shrink-0">
        {selectionMode ? (
          <input
            type="checkbox"
            className="rounded border-border w-4 h-4 accent-primary cursor-pointer"
            checked={!!selected}
            onChange={() => onToggleSelect?.(track.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${track.title}`}
          />
        ) : (
          <>
            <span className={`text-sm font-mono group-hover:hidden ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
              {index + 1}
            </span>
            <button
              type="button"
              data-testid="track-row-play-button"
              onClick={(event) => {
                event.stopPropagation();
                handlePlayButtonClick();
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className="hidden group-hover:block"
            >
              {isActive && isPlaying ? <Pause className="w-4 h-4 text-primary mx-auto" /> : <Play className="w-4 h-4 text-foreground mx-auto" />}
            </button>
          </>
        )}
      </div>

      <Image
        src={track.artwork}
        alt=""
        width={40}
        height={40}
        unoptimized
        loading="lazy"
        className="w-10 h-10 rounded object-cover flex-shrink-0"
      />

      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isActive ? 'text-primary font-medium' : 'text-foreground'}`}>{track.title}</p>
        <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
      </div>

      {showAlbum && (
        <p className="text-sm text-muted-foreground truncate w-[200px] hidden lg:block">{track.album}</p>
      )}

      {(startsAtClock != null || startsIn != null) && (
        <div className="w-[104px] shrink-0 text-right hidden md:block">
          {startsAtClock != null && (
            <p className="text-xs text-foreground tabular-nums leading-tight">{startsAtClock}</p>
          )}
          {startsIn != null && (
            <p className="text-[10px] text-muted-foreground tabular-nums leading-tight mt-0.5">{startsIn}</p>
          )}
        </div>
      )}

      <span className="text-sm text-muted-foreground font-mono w-12 text-right">{formatDuration(track.duration)}</span>

      {showActions ? <TrackActionsMenu track={track} queuePosition={queuePosition} /> : <div className="w-6 shrink-0" aria-hidden />}
    </motion.div>
  );
}
