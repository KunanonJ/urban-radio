'use client';

import { Pause, Play, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAudioPlayer } from '@/lib/hooks/use-audio-player';
import { formatDuration } from '@/lib/utils/format';

export function AudioPlayerBar() {
  const player = useAudioPlayer();

  if (!player.trackId) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur">
      <div className="flex items-center gap-4 px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => (player.isPlaying ? player.pause() : player.resume())}
        >
          {player.isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{player.trackTitle}</span>
          <span className="truncate text-xs text-muted-foreground">
            {player.artistName}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDuration(Math.round(player.currentTime))}
          </span>
          <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: player.duration > 0
                  ? `${(player.currentTime / player.duration) * 100}%`
                  : '0%',
              }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDuration(Math.round(player.duration))}
          </span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={player.stop}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
