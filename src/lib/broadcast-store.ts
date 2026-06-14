import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type EncoderStatus = 'idle' | 'connecting' | 'streaming' | 'error';

type BroadcastState = {
  isOnAir: boolean;
  /** Simulated Icecast/Shoutcast mount path for display */
  streamMount: string;
  /** Template with {title} {artist} {album} */
  metadataTemplate: string;
  encoderStatus: EncoderStatus;
  lastMetadata: string;
  lastError: string | null;
  setOnAir: (v: boolean) => void;
  setStreamMount: (v: string) => void;
  setMetadataTemplate: (v: string) => void;
  setEncoderStatus: (s: EncoderStatus) => void;
  setLastMetadata: (line: string) => void;
  setLastError: (e: string | null) => void;
  /** Mock connect cycle for UI demos */
  mockStartEncoder: () => void;
  mockStopEncoder: () => void;
};

export const useBroadcastStore = create<BroadcastState>()(
  persist(
    (set, get) => ({
      isOnAir: false,
      streamMount: '/stream',
      metadataTemplate: '{artist} — {title}',
      encoderStatus: 'idle',
      lastMetadata: '',
      lastError: null,
      setOnAir: (v) => set({ isOnAir: v }),
      setStreamMount: (streamMount) => set({ streamMount }),
      setMetadataTemplate: (metadataTemplate) => set({ metadataTemplate }),
      setEncoderStatus: (encoderStatus) => set({ encoderStatus }),
      setLastMetadata: (lastMetadata) => set({ lastMetadata }),
      setLastError: (lastError) => set({ lastError }),
      mockStartEncoder: () => {
        set({ encoderStatus: 'connecting', lastError: null });
        window.setTimeout(() => {
          if (get().encoderStatus === 'connecting') {
            set({ encoderStatus: 'streaming', isOnAir: true });
          }
        }, 600);
      },
      mockStopEncoder: () => {
        set({ encoderStatus: 'idle', isOnAir: false });
      },
    }),
    {
      name: 'sonic-bloom-broadcast',
      partialize: (s) => ({
        streamMount: s.streamMount,
        metadataTemplate: s.metadataTemplate,
      }),
    }
  )
);

export function formatBroadcastMetadata(
  template: string,
  title: string,
  artist: string,
  album: string
): string {
  return template
    .replace(/\{title\}/gi, title)
    .replace(/\{artist\}/gi, artist)
    .replace(/\{album\}/gi, album);
}

interface EncoderEnv {
  NEXT_PUBLIC_ENCODER_URL?: string;
}

/**
 * Returns true when no real encoder is wired. UI must show "Demo mode" in that case —
 * mockStartEncoder() does not actually broadcast.
 */
export function isDemoEncoder(env: EncoderEnv = readEncoderEnv()): boolean {
  const url = env.NEXT_PUBLIC_ENCODER_URL?.trim();
  return !url;
}

function readEncoderEnv(): EncoderEnv {
  return {
    NEXT_PUBLIC_ENCODER_URL: process.env.NEXT_PUBLIC_ENCODER_URL,
  };
}
