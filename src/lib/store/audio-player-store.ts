import { create } from 'zustand';

interface AudioPlayerState {
  readonly trackId: string | null;
  readonly trackTitle: string | null;
  readonly artistName: string | null;
  readonly url: string | null;
  readonly isPlaying: boolean;
  readonly currentTime: number;
  readonly duration: number;
}

interface AudioPlayerActions {
  readonly play: (track: {
    id: string;
    title: string;
    artistName: string;
    url: string;
  }) => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly stop: () => void;
  readonly setCurrentTime: (time: number) => void;
  readonly setDuration: (duration: number) => void;
}

type AudioPlayerStore = AudioPlayerState & AudioPlayerActions;

export const useAudioPlayerStore = create<AudioPlayerStore>((set) => ({
  trackId: null,
  trackTitle: null,
  artistName: null,
  url: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,

  play: (track) =>
    set({
      trackId: track.id,
      trackTitle: track.title,
      artistName: track.artistName,
      url: track.url,
      isPlaying: true,
      currentTime: 0,
      duration: 0,
    }),

  pause: () => set({ isPlaying: false }),
  resume: () => set({ isPlaying: true }),
  stop: () =>
    set({
      trackId: null,
      trackTitle: null,
      artistName: null,
      url: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
    }),

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
}));
