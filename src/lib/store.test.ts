import { afterEach, describe, expect, test } from 'vitest';
import { mockTracks } from '@/lib/mock-data';
import { isPlaybackEnded, PLAYBACK_ENDED_THRESHOLD, usePlayerStore } from '@/lib/store';

const initialState = (() => {
  const state = usePlayerStore.getState();
  return {
    currentTrack: state.currentTrack,
    isPlaying: state.isPlaying,
    progress: state.progress,
    volume: state.volume,
    isMuted: state.isMuted,
    repeat: state.repeat,
    shuffle: state.shuffle,
    queue: [...state.queue],
    queueIndex: state.queueIndex,
    isFullscreenPlayer: state.isFullscreenPlayer,
    isSearchOpen: state.isSearchOpen,
    currentTrackStartedAtMs: state.currentTrackStartedAtMs,
    crossfadeEnabled: state.crossfadeEnabled,
    crossfadeDurationSec: state.crossfadeDurationSec,
    playbackConnectionState: state.playbackConnectionState,
    autoResumePlayback: state.autoResumePlayback,
  };
})();

afterEach(() => {
  usePlayerStore.setState({
    ...initialState,
    queue: [...initialState.queue],
  });
});

describe('playback ended threshold', () => {
  test('isPlaybackEnded matches shared threshold semantics', () => {
    expect(isPlaybackEnded(PLAYBACK_ENDED_THRESHOLD)).toBe(true);
    expect(isPlaybackEnded(1)).toBe(true);
    expect(isPlaybackEnded(PLAYBACK_ENDED_THRESHOLD - 0.001)).toBe(false);
  });
});

describe('usePlayerStore initial state', () => {
  test('given fresh store > currentTrack is null', () => {
    expect(initialState.currentTrack).toBeNull();
  });

  test('given fresh store > queue is empty', () => {
    expect(initialState.queue).toEqual([]);
  });

  test('given fresh store > isPlaying is false', () => {
    expect(initialState.isPlaying).toBe(false);
  });

  test('given fresh store > progress is 0', () => {
    expect(initialState.progress).toBe(0);
  });

  test('given fresh store > currentTrackStartedAtMs is null', () => {
    expect(initialState.currentTrackStartedAtMs).toBeNull();
  });
});

describe('usePlayerStore queue playback helpers', () => {
  test('playAtQueueIndex activates the selected queue position', () => {
    const queue = [mockTracks[0], mockTracks[1], mockTracks[0]];

    usePlayerStore.setState({
      currentTrack: queue[0],
      isPlaying: false,
      progress: 0.42,
      queue,
      queueIndex: 0,
      currentTrackStartedAtMs: null,
    });

    usePlayerStore.getState().playAtQueueIndex(2);

    const next = usePlayerStore.getState();
    expect(next.queueIndex).toBe(2);
    expect(next.currentTrack).toBe(queue[2]);
    expect(next.isPlaying).toBe(true);
    expect(next.progress).toBe(0);
    expect(next.currentTrackStartedAtMs).not.toBeNull();
  });

  test('togglePlay restarts an ended active track', () => {
    usePlayerStore.setState({
      currentTrack: mockTracks[0],
      isPlaying: false,
      progress: 1,
      queue: mockTracks.slice(0, 3),
      queueIndex: 0,
      currentTrackStartedAtMs: null,
    });

    usePlayerStore.getState().togglePlay();

    const next = usePlayerStore.getState();
    expect(next.isPlaying).toBe(true);
    expect(next.progress).toBe(0);
    expect(next.currentTrackStartedAtMs).not.toBeNull();
  });
});
