import { create } from 'zustand';
import { arrayMove } from '@dnd-kit/sortable';
import { PlaybackState, Track } from './types';
import { setAutoResumePreference } from './playback-persist';
import { newQueueIndexAfterMove } from './queue-reorder';

export type PlaybackConnectionState = 'ok' | 'offline' | 'recovering' | 'failed';

interface PlayerStore extends PlaybackState {
  /** Wall-clock ms when the current track began (progress ≈ 0). */
  currentTrackStartedAtMs: number | null;
  /** Crossfade tail length in seconds (2–15). Applies when both current and next have `mediaUrl`. */
  crossfadeEnabled: boolean;
  crossfadeDurationSec: number;
  play: (track?: Track) => void;
  pause: () => void;
  togglePlay: () => void;
  next: () => void;
  previous: () => void;
  seek: (progress: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleRepeat: () => void;
  toggleShuffle: () => void;
  toggleCrossfade: () => void;
  setCrossfadeDurationSec: (sec: number) => void;
  playAtQueueIndex: (index: number) => void;
  addToQueue: (track: Track) => void;
  playNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  /** Reorder queue; updates queueIndex so the same track stays current. No-op when shuffle is on. */
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  setQueue: (tracks: Track[], startIndex?: number) => void;
  isFullscreenPlayer: boolean;
  setFullscreenPlayer: (v: boolean) => void;
  isSearchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  /** Called by PlaybackEngine only */
  syncProgress: (progress: number) => void;
  /** When a track finishes (audio ended or simulated progress ≥ 1) */
  handleTrackEnded: () => void;
  /** Next track in order (no advance). Null if none / shuffle (crossfade disabled for shuffle). */
  getNextTrack: () => Track | null;
  /** Advance to next track with explicit progress on the incoming track (0–1). Used after crossfade. */
  advanceAfterCurrentTrackEnd: (progressForNext: number) => void;
  /** Network / decode recovery (driven by PlaybackEngine). */
  playbackConnectionState: PlaybackConnectionState;
  setPlaybackConnectionState: (s: PlaybackConnectionState) => void;
  /** When true, resume after reconnect / reload when possible (persisted separately). */
  autoResumePlayback: boolean;
  setAutoResumePlayback: (v: boolean) => void;
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

/** Treat progress at/above this as finished for resume vs restart (toggle, row actions). */
export const PLAYBACK_ENDED_THRESHOLD = 0.999;

export function isPlaybackEnded(progress: number) {
  return progress >= PLAYBACK_ENDED_THRESHOLD;
}

function clampCrossfadeSec(n: number) {
  return Math.min(15, Math.max(2, Math.round(n)));
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  progress: 0,
  volume: 0.75,
  isMuted: false,
  repeat: 'off',
  shuffle: false,
  queue: [],
  queueIndex: 0,
  isFullscreenPlayer: false,
  isSearchOpen: false,
  currentTrackStartedAtMs: null,
  crossfadeEnabled: false,
  crossfadeDurationSec: 4,
  playbackConnectionState: 'ok' as PlaybackConnectionState,
  autoResumePlayback: true,

  setPlaybackConnectionState: (playbackConnectionState) => set({ playbackConnectionState }),

  setAutoResumePlayback: (autoResumePlayback) => {
    set({ autoResumePlayback });
    setAutoResumePreference(autoResumePlayback);
  },

  syncProgress: (progress) => set({ progress: clamp01(progress) }),

  getNextTrack: () => {
    const { queue, queueIndex, repeat, shuffle } = get();
    if (queue.length === 0) return null;
    if (shuffle) return null;
    if (repeat === 'one') return queue[queueIndex] ?? null;
    const atEnd = queueIndex >= queue.length - 1;
    if (repeat === 'off' && atEnd) return null;
    return queue[(queueIndex + 1) % queue.length] ?? null;
  },

  advanceAfterCurrentTrackEnd: (progressForNext) => {
    const { repeat, queue, queueIndex, shuffle } = get();
    if (queue.length === 0) {
      set({ isPlaying: false, progress: 0 });
      return;
    }
    if (repeat === 'one') {
      set({ progress: 0, currentTrackStartedAtMs: Date.now() });
      return;
    }
    if (shuffle && queue.length > 1) {
      const others = queue.map((_, i) => i).filter((i) => i !== queueIndex);
      const pick = others[Math.floor(Math.random() * others.length)];
      set({
        queueIndex: pick,
        currentTrack: queue[pick],
        progress: progressForNext,
        currentTrackStartedAtMs: Date.now(),
      });
      return;
    }
    const atEnd = queueIndex >= queue.length - 1;
    if (repeat === 'off' && atEnd) {
      set({ isPlaying: false, progress: 1, currentTrackStartedAtMs: null });
      return;
    }
    const nextIdx = (queueIndex + 1) % queue.length;
    set({
      queueIndex: nextIdx,
      currentTrack: queue[nextIdx],
      progress: clamp01(progressForNext),
      currentTrackStartedAtMs: Date.now(),
    });
  },

  handleTrackEnded: () => get().advanceAfterCurrentTrackEnd(0),

  playAtQueueIndex: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    set({
      currentTrack: queue[index],
      isPlaying: true,
      queueIndex: index,
      progress: 0,
      currentTrackStartedAtMs: Date.now(),
    });
  },

  play: (track) => {
    const q = get().queue;
    if (track) {
      const idx = q.findIndex((t) => t.id === track.id);
      if (idx >= 0) {
        set({
          currentTrack: track,
          isPlaying: true,
          queueIndex: idx,
          progress: 0,
          currentTrackStartedAtMs: Date.now(),
        });
      } else {
        set({
          currentTrack: track,
          isPlaying: true,
          queue: [track, ...q],
          queueIndex: 0,
          progress: 0,
          currentTrackStartedAtMs: Date.now(),
        });
      }
    } else {
      set({ isPlaying: true });
    }
  },

  pause: () => set({ isPlaying: false }),

  togglePlay: () =>
    set((s) => {
      if (!s.isPlaying && isPlaybackEnded(s.progress) && s.currentTrack) {
        return { isPlaying: true, progress: 0, currentTrackStartedAtMs: Date.now() };
      }
      return { isPlaying: !s.isPlaying };
    }),

  next: () => {
    const { queue, queueIndex, repeat, shuffle } = get();
    if (queue.length === 0) return;
    if (repeat === 'one') {
      set({ progress: 0, currentTrackStartedAtMs: Date.now() });
      return;
    }
    if (shuffle && queue.length > 1) {
      const others = queue.map((_, i) => i).filter((i) => i !== queueIndex);
      const pick = others[Math.floor(Math.random() * others.length)];
      set({
        queueIndex: pick,
        currentTrack: queue[pick],
        progress: 0,
        currentTrackStartedAtMs: Date.now(),
      });
      return;
    }
    const atEnd = queueIndex >= queue.length - 1;
    if (repeat === 'off' && atEnd) {
      set({ isPlaying: false, progress: 0 });
      return;
    }
    const nextIdx = (queueIndex + 1) % queue.length;
    set({
      queueIndex: nextIdx,
      currentTrack: queue[nextIdx],
      progress: 0,
      currentTrackStartedAtMs: Date.now(),
    });
  },

  previous: () => {
    const { queue, queueIndex } = get();
    if (queue.length === 0) return;
    const prevIdx = queueIndex === 0 ? queue.length - 1 : queueIndex - 1;
    set({
      queueIndex: prevIdx,
      currentTrack: queue[prevIdx],
      progress: 0,
      currentTrackStartedAtMs: Date.now(),
    });
  },

  seek: (progress) => set({ progress: clamp01(progress) }),

  setVolume: (volume) => set({ volume, isMuted: volume === 0 }),

  toggleMute: () => set((s) => ({ isMuted: !s.isMuted })),

  toggleRepeat: () =>
    set((s) => ({ repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' })),

  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),

  toggleCrossfade: () => set((s) => ({ crossfadeEnabled: !s.crossfadeEnabled })),

  setCrossfadeDurationSec: (sec) => set({ crossfadeDurationSec: clampCrossfadeSec(sec) }),

  addToQueue: (track) => set((s) => ({ queue: [...s.queue, track] })),

  playNext: (track) =>
    set((s) => ({
      queue: [...s.queue.slice(0, s.queueIndex + 1), track, ...s.queue.slice(s.queueIndex + 1)],
    })),

  removeFromQueue: (index) =>
    set((s) => {
      const queue = s.queue.filter((_, i) => i !== index);
      let queueIndex = s.queueIndex;
      let currentTrack = s.currentTrack;
      if (index < s.queueIndex) queueIndex -= 1;
      else if (index === s.queueIndex) {
        if (queue.length === 0) {
          currentTrack = null;
          queueIndex = 0;
        } else {
          queueIndex = Math.min(queueIndex, queue.length - 1);
          currentTrack = queue[queueIndex];
        }
      }
      return { queue, queueIndex, currentTrack, progress: index === s.queueIndex ? 0 : s.progress };
    }),

  moveQueueItem: (fromIndex, toIndex) =>
    set((s) => {
      if (s.shuffle) return s;
      if (fromIndex === toIndex) return s;
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= s.queue.length || toIndex >= s.queue.length) {
        return s;
      }
      const queue = arrayMove(s.queue, fromIndex, toIndex);
      const queueIndex = newQueueIndexAfterMove(s.queueIndex, fromIndex, toIndex);
      const currentTrack = queue[queueIndex] ?? s.currentTrack;
      return { queue, queueIndex, currentTrack };
    }),

  setQueue: (tracks, startIndex = 0) => {
    if (tracks.length === 0) {
      set({
        queue: [],
        queueIndex: 0,
        currentTrack: null,
        progress: 0,
        isPlaying: false,
        currentTrackStartedAtMs: null,
      });
      return;
    }
    const idx = Math.min(Math.max(0, startIndex), tracks.length - 1);
    set({
      queue: tracks,
      queueIndex: idx,
      currentTrack: tracks[idx],
      progress: 0,
      isPlaying: true,
      currentTrackStartedAtMs: Date.now(),
    });
  },

  setFullscreenPlayer: (v) => set({ isFullscreenPlayer: v }),

  setSearchOpen: (v) => set({ isSearchOpen: v }),
}));
