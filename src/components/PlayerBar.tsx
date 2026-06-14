'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { useHydrated } from '@/hooks/use-hydrated';
import { usePlayerStore } from '@/lib/store';
import { formatDuration } from '@/lib/format';
import { Play, Pause, SkipBack, SkipForward, Repeat, Repeat1, Shuffle, Volume2, VolumeX, Maximize2, ListMusic, Waves } from 'lucide-react';
import { motion } from 'framer-motion';

export function PlayerBar() {
  const { t } = useTranslation();
  const hydrated = useHydrated();
  const {
    currentTrack, isPlaying, progress, volume, isMuted, repeat, shuffle,
    crossfadeEnabled,
    togglePlay, next, previous, seek, setVolume, toggleMute, toggleRepeat, toggleShuffle, toggleCrossfade,
    setFullscreenPlayer,
  } = usePlayerStore();

  if (!currentTrack) return null;

  const safeProgress = hydrated ? progress : 0;
  const currentTime = Math.floor(safeProgress * currentTrack.duration);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex flex-col pb-[env(safe-area-inset-bottom,0px)] surface-2 border-t border-border">
      <div className="mx-auto flex w-full max-w-[1920px] items-center h-[var(--player-height)] px-2 sm:px-4 lg:px-6 xl:px-8 gap-2 sm:gap-4">
        {/* Track info */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 md:w-[280px] md:flex-none md:shrink-0">
          <button
            type="button"
            onClick={() => setFullscreenPlayer(true)}
            className="relative group flex-shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Image
              src={currentTrack.artwork}
              alt=""
              width={48}
              height={48}
              unoptimized
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-md object-cover"
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center">
              <Maximize2 className="w-4 h-4 text-foreground" />
            </div>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-sm font-medium truncate text-foreground">{currentTrack.title}</p>
            <Link
              href={`/app/artist/${currentTrack.artistId}`}
              className="text-[11px] sm:text-xs text-muted-foreground hover:text-foreground transition-colors truncate block"
            >
              {currentTrack.artist}
            </Link>
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex-[2] min-w-0 flex flex-col items-center gap-1 max-w-[600px] xl:max-w-[680px]">
          <div className="flex items-center justify-center gap-0.5 sm:gap-3 w-full max-w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={toggleShuffle}
              className={`p-2 sm:p-1.5 rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 ${shuffle ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Shuffle className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={previous}
              className="p-2 sm:p-1.5 text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              type="button"
              onClick={togglePlay}
              className="w-10 h-10 sm:w-9 sm:h-9 rounded-full bg-foreground text-background flex items-center justify-center hover:scale-105 transition-transform shrink-0"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </motion.button>
            <button
              type="button"
              onClick={next}
              className="p-2 sm:p-1.5 text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
            >
              <SkipForward className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleRepeat}
              className={`p-2 sm:p-1.5 rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 ${repeat !== 'off' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {repeat === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={toggleCrossfade}
              title={t('player.crossfadeTitle')}
              className={`p-2 sm:p-1.5 rounded-full transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 ${crossfadeEnabled ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Waves className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 w-full px-1">
            <span className="text-[10px] text-muted-foreground font-mono w-8 sm:w-10 text-right shrink-0">
              {formatDuration(currentTime)}
            </span>
            <div
              className="flex-1 h-1 bg-muted rounded-full cursor-pointer group relative min-w-0"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                seek((e.clientX - rect.left) / rect.width);
              }}
              role="presentation"
            >
              <div className="h-full bg-foreground rounded-full relative" style={{ width: `${safeProgress * 100}%` }}>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-md" />
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono w-8 sm:w-10 shrink-0">{formatDuration(currentTrack.duration)}</span>
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 md:w-[200px] lg:w-[220px] xl:w-[240px] justify-end">
          <Link
            href="/app/queue"
            className="p-2 sm:p-1.5 text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <ListMusic className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleMute}
              className="p-2 sm:p-1.5 text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <div
              className="hidden sm:block w-20 lg:w-24 xl:w-28 h-1 bg-muted rounded-full cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setVolume((e.clientX - rect.left) / rect.width);
              }}
              role="presentation"
            >
              <div className="h-full bg-foreground rounded-full" style={{ width: `${(isMuted ? 0 : volume) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
