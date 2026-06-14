import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TrackRow } from '@/components/TrackRow';
import { mockTracks } from '@/lib/mock-data';
import { usePlayerStore } from '@/lib/store';

vi.mock('@/components/track/TrackActionsMenu', () => ({
  TrackActionsMenu: () => null,
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>,
  },
}));

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

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  usePlayerStore.setState({
    ...initialState,
    queue: [...initialState.queue],
  });
});

function renderTrackRow(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return { container, root };
}

function cleanupRenderedRow(container: HTMLDivElement, root: Root) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

describe('TrackRow queue playback behavior', () => {
  test('single click starts playback for a queued row', () => {
    const queue = [mockTracks[0], mockTracks[1]];

    usePlayerStore.setState({
      currentTrack: queue[0],
      isPlaying: false,
      progress: 0,
      queue,
      queueIndex: 0,
      currentTrackStartedAtMs: null,
    });

    const { container, root } = renderTrackRow(<TrackRow track={queue[1]} index={1} queuePosition={1} />);
    const row = container.querySelector('[data-testid="track-row"]');
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const next = usePlayerStore.getState();
    expect(next.isPlaying).toBe(true);
    expect(next.progress).toBe(0);
    expect(next.queueIndex).toBe(1);
    expect(next.currentTrack).toBe(queue[1]);

    cleanupRenderedRow(container, root);
  });

  test('double click restarts an ended active queue row', () => {
    const queue = [mockTracks[0], mockTracks[1]];

    usePlayerStore.setState({
      currentTrack: queue[0],
      isPlaying: false,
      progress: 1,
      queue,
      queueIndex: 0,
      currentTrackStartedAtMs: null,
    });

    const { container, root } = renderTrackRow(<TrackRow track={queue[0]} index={0} queuePosition={0} />);
    const row = container.querySelector('[data-testid="track-row"]');
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    const next = usePlayerStore.getState();
    expect(next.isPlaying).toBe(true);
    expect(next.progress).toBe(0);
    expect(next.queueIndex).toBe(0);
    expect(next.currentTrack).toBe(queue[0]);

    cleanupRenderedRow(container, root);
  });

  test('inline play button restarts an ended active row', () => {
    const queue = [mockTracks[0], mockTracks[1]];

    usePlayerStore.setState({
      currentTrack: queue[0],
      isPlaying: false,
      progress: 1,
      queue,
      queueIndex: 0,
      currentTrackStartedAtMs: null,
    });

    const { container, root } = renderTrackRow(<TrackRow track={queue[0]} index={0} queuePosition={0} />);
    const button = container.querySelector('[data-testid="track-row-play-button"]');
    expect(button).not.toBeNull();

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const next = usePlayerStore.getState();
    expect(next.isPlaying).toBe(true);
    expect(next.progress).toBe(0);
    expect(next.queueIndex).toBe(0);
    expect(next.currentTrack).toBe(queue[0]);

    cleanupRenderedRow(container, root);
  });
});
