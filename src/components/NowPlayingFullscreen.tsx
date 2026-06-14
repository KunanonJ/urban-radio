'use client';

import Image from 'next/image';
import { usePlayerStore } from '@/lib/store';
import { formatDuration } from '@/lib/format';
import { X, Play, Pause, SkipBack, SkipForward, Repeat, Repeat1, Shuffle, Volume2, VolumeX, ListMusic } from 'lucide-react';
import { motion } from 'framer-motion';

export function NowPlayingFullscreen() {
  const {
    currentTrack, isPlaying, progress, volume, isMuted, repeat, shuffle,
    togglePlay, next, previous, seek, setVolume, toggleMute, toggleRepeat, toggleShuffle,
    setFullscreenPlayer, queue, queueIndex, isFullscreenPlayer,
  } = usePlayerStore();

  if (!isFullscreenPlayer || !currentTrack) return null;

  const currentTime = Math.floor(progress * currentTrack.duration);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed inset-0 z-[90] bg-background flex flex-col"
    >
      {/* Background blur artwork */}
      <div className="absolute inset-0 overflow-hidden">
        <Image
          src={currentTrack.artwork}
          alt=""
          fill
          unoptimized
          className="object-cover opacity-20 blur-[80px] scale-150"
        />
        <div className="absolute inset-0 bg-background/70" />
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between p-6">
        <button onClick={() => setFullscreenPlayer(false)} className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <X className="w-5 h-5" />
        </button>
        <span className="text-xs uppercase tracking-widest text-muted-foreground font-medium">Now Playing</span>
        <div className="w-9" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex items-center justify-center gap-16 px-16">
        {/* Artwork */}
        <motion.div
          animate={{ scale: isPlaying ? 1 : 0.95 }}
          transition={{ duration: 0.4 }}
          className="relative w-[400px] h-[400px] rounded-2xl overflow-hidden shadow-2xl flex-shrink-0"
        >
          <Image
            src={currentTrack.artwork}
            alt=""
            fill
            unoptimized
            className="object-cover"
          />
        </motion.div>

        {/* Info + Controls */}
        <div className="flex flex-col gap-8 max-w-md w-full">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{currentTrack.title}</h1>
            <p className="text-lg text-muted-foreground mt-1">{currentTrack.artist}</p>
            <p className="text-sm text-muted-foreground/60 mt-0.5">{currentTrack.album}</p>
          </div>

          {/* Progress */}
          <div className="space-y-2">
            <div className="h-1.5 bg-muted rounded-full cursor-pointer" onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seek((e.clientX - rect.left) / rect.width);
            }}>
              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground font-mono">{formatDuration(currentTime)}</span>
              <span className="text-xs text-muted-foreground font-mono">{formatDuration(currentTrack.duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-6">
            <button onClick={toggleShuffle} className={`p-2 rounded-full transition-colors ${shuffle ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              <Shuffle className="w-5 h-5" />
            </button>
            <button onClick={previous} className="p-2 text-muted-foreground hover:text-foreground transition-colors">
              <SkipBack className="w-6 h-6" />
            </button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={togglePlay}
              className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center glow-green"
            >
              {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-1" />}
            </motion.button>
            <button onClick={next} className="p-2 text-muted-foreground hover:text-foreground transition-colors">
              <SkipForward className="w-6 h-6" />
            </button>
            <button onClick={toggleRepeat} className={`p-2 rounded-full transition-colors ${repeat !== 'off' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
              {repeat === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
            </button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-3 justify-center">
            <button onClick={toggleMute} className="text-muted-foreground hover:text-foreground">
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <div className="w-32 h-1 bg-muted rounded-full cursor-pointer" onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setVolume((e.clientX - rect.left) / rect.width);
            }}>
              <div className="h-full bg-foreground rounded-full" style={{ width: `${(isMuted ? 0 : volume) * 100}%` }} />
            </div>
          </div>

          {/* Queue preview */}
          <div className="surface-2 rounded-xl p-4 border border-border">
            <div className="flex items-center gap-2 mb-3">
              <ListMusic className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Up Next</span>
            </div>
            <div className="space-y-2">
              {queue.slice(queueIndex + 1, queueIndex + 4).map((t) => (
                <div key={t.id} className="flex items-center gap-3">
                  <Image
                    src={t.artwork}
                    alt=""
                    width={32}
                    height={32}
                    unoptimized
                    className="w-8 h-8 rounded object-cover"
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{t.artist}</p>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono ml-auto">{formatDuration(t.duration)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
