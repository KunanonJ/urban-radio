import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** UI-only until a real codec pipeline exists. */
export type LosslessQualityKey = 'aac256' | 'alac' | 'off';

export type SpatialDolbyKey = 'auto' | 'off' | 'always';

export type HdmiPassthroughKey = 'off' | 'on' | 'auto';

export type VideoQualityKey = 'auto' | '720p' | '1080p';

type PlaybackPreferencesState = {
  /** Level perceived loudness toward a common target (UI + future DSP). */
  soundCheckEnabled: boolean;
  soundEnhancerEnabled: boolean;
  /** 0 = low, 100 = high */
  soundEnhancerLevel: number;
  losslessEnabled: boolean;
  losslessStreaming: LosslessQualityKey;
  losslessDownload: LosslessQualityKey;
  spatialDolbyAtmos: SpatialDolbyKey;
  hdmiPassthrough: HdmiPassthroughKey;
  videoQuality: VideoQualityKey;
  setSoundCheck: (v: boolean) => void;
  setSoundEnhancerEnabled: (v: boolean) => void;
  setSoundEnhancerLevel: (n: number) => void;
  setLosslessEnabled: (v: boolean) => void;
  setLosslessStreaming: (v: LosslessQualityKey) => void;
  setLosslessDownload: (v: LosslessQualityKey) => void;
  setSpatialDolbyAtmos: (v: SpatialDolbyKey) => void;
  setHdmiPassthrough: (v: HdmiPassthroughKey) => void;
  setVideoQuality: (v: VideoQualityKey) => void;
};

function clampEnhancer(n: number) {
  return Math.min(100, Math.max(0, Math.round(n)));
}

export const usePlaybackPreferencesStore = create<PlaybackPreferencesState>()(
  persist(
    (set) => ({
      soundCheckEnabled: false,
      soundEnhancerEnabled: false,
      soundEnhancerLevel: 50,
      losslessEnabled: false,
      losslessStreaming: 'aac256',
      losslessDownload: 'aac256',
      spatialDolbyAtmos: 'auto',
      hdmiPassthrough: 'off',
      videoQuality: 'auto',

      setSoundCheck: (v) => set({ soundCheckEnabled: v }),
      setSoundEnhancerEnabled: (v) => set({ soundEnhancerEnabled: v }),
      setSoundEnhancerLevel: (n) => set({ soundEnhancerLevel: clampEnhancer(n) }),
      setLosslessEnabled: (v) => set({ losslessEnabled: v }),
      setLosslessStreaming: (v) => set({ losslessStreaming: v }),
      setLosslessDownload: (v) => set({ losslessDownload: v }),
      setSpatialDolbyAtmos: (v) => set({ spatialDolbyAtmos: v }),
      setHdmiPassthrough: (v) => set({ hdmiPassthrough: v }),
      setVideoQuality: (v) => set({ videoQuality: v }),
    }),
    { name: 'sonic-bloom-playback-prefs' }
  )
);
