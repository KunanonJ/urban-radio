"use client";
import Image from 'next/image';
import { usePlayerStore } from '@/lib/store';
import { Radio } from 'lucide-react';

export default function NowPlayingPage() {
  const { currentTrack, setFullscreenPlayer } = usePlayerStore();

  if (!currentTrack) {
    return (
      <div className="app-page">
        <div className="surface-2 border border-border rounded-xl p-16 text-center">
          <Radio className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">Nothing playing</h2>
          <p className="text-muted-foreground">Choose a track to start listening</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      <button
        onClick={() => setFullscreenPlayer(true)}
        className="w-full surface-2 border border-border rounded-xl overflow-hidden hover:border-primary/20 transition-colors group"
      >
        <div className="relative h-[400px]">
          <Image
            src={currentTrack.artwork}
            alt=""
            fill
            unoptimized
            className="object-cover opacity-40 blur-[40px] scale-110"
          />
          <div className="absolute inset-0 bg-background/50" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Image
                src={currentTrack.artwork}
                alt=""
                width={192}
                height={192}
                unoptimized
                className="w-48 h-48 rounded-xl mx-auto shadow-2xl mb-6"
              />
              <h2 className="text-2xl font-bold text-foreground">{currentTrack.title}</h2>
              <p className="text-muted-foreground mt-1">{currentTrack.artist}</p>
              <p className="text-sm text-primary mt-4 opacity-0 group-hover:opacity-100 transition-opacity">Click to expand fullscreen</p>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
