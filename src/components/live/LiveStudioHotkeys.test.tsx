import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { LiveStudioHotkeys } from './LiveStudioHotkeys';
import { usePlayerStore } from '@/lib/store';
import { mockTracks } from '@/lib/mock-data';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = (() => {
  const s = usePlayerStore.getState();
  return {
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    progress: s.progress,
    volume: s.volume,
    isMuted: s.isMuted,
    repeat: s.repeat,
    shuffle: s.shuffle,
    queue: [...s.queue],
    queueIndex: s.queueIndex,
    isFullscreenPlayer: s.isFullscreenPlayer,
    isSearchOpen: s.isSearchOpen,
    currentTrackStartedAtMs: s.currentTrackStartedAtMs,
    crossfadeEnabled: s.crossfadeEnabled,
    crossfadeDurationSec: s.crossfadeDurationSec,
    playbackConnectionState: s.playbackConnectionState,
    autoResumePlayback: s.autoResumePlayback,
  };
})();

interface Mounted {
  container: HTMLDivElement;
  root: Root;
}

const mounted: Mounted[] = [];

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<LiveStudioHotkeys />);
  });
  const m = { container, root };
  mounted.push(m);
  return m;
}

function press(opts: KeyboardEventInit & { key: string; code?: string }) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...opts }));
  });
}

beforeEach(() => {
  usePlayerStore.setState({
    ...initialState,
    queue: [...initialState.queue],
  });
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    if (!m) continue;
    act(() => {
      m.root.unmount();
    });
    m.container.remove();
  }
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe('LiveStudioHotkeys', () => {
  test('given Space > calls togglePlay', () => {
    usePlayerStore.setState({
      currentTrack: mockTracks[0],
      queue: [mockTracks[0], mockTracks[1]],
      queueIndex: 0,
      isPlaying: false,
    });
    mount();
    press({ key: ' ', code: 'Space' });
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  test('given ArrowRight > calls next', () => {
    const queue = [mockTracks[0], mockTracks[1], mockTracks[2]];
    usePlayerStore.setState({
      currentTrack: queue[0],
      queue,
      queueIndex: 0,
      isPlaying: true,
    });
    mount();
    press({ key: 'ArrowRight' });
    expect(usePlayerStore.getState().queueIndex).toBe(1);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(queue[1].id);
  });

  test('given key in input target > does NOT call any action', () => {
    usePlayerStore.setState({
      currentTrack: mockTracks[0],
      queue: [mockTracks[0], mockTracks[1]],
      queueIndex: 0,
      isPlaying: false,
    });
    mount();
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.focus();
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ', code: 'Space' }));
    });
    expect(usePlayerStore.getState().isPlaying).toBe(false);
  });

  test('given M key > calls toggleMute', () => {
    usePlayerStore.setState({
      currentTrack: mockTracks[0],
      queue: [mockTracks[0]],
      queueIndex: 0,
      isMuted: false,
    });
    mount();
    press({ key: 'm' });
    expect(usePlayerStore.getState().isMuted).toBe(true);
  });
});
