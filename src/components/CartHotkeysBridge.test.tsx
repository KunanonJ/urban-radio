import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CartHotkeysBridge } from '@/components/CartHotkeysBridge';
import {
  type CartTab,
  useCartStore,
} from '@/lib/cart-store';
import { usePlayerStore } from '@/lib/store';
import { mockTracks } from '@/lib/mock-data';
import type { Track } from '@/lib/types';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialPlayerState = (() => {
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

function makeTab(slots: (Track | null)[], id = 'tab-1'): CartTab {
  // Round up to a 4-wide grid to keep dimensions valid.
  const cols = 4;
  const rows = Math.max(4, Math.ceil(slots.length / cols));
  const padded = [...slots];
  while (padded.length < cols * rows) padded.push(null);
  return { id, name: 'Test', gridCols: cols, gridRows: rows, slots: padded };
}

function freshCart(tab: CartTab, auditionMode = false) {
  useCartStore.setState({
    tabs: [tab],
    activeTabId: tab.id,
    auditionMode,
    slots: tab.slots,
  });
}

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<CartHotkeysBridge />);
  });
  return { container, root };
}

function unmount(container: HTMLDivElement, root: Root) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function pressKey(opts: KeyboardEventInit & { key: string; code?: string }) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...opts }));
  });
}

beforeEach(() => {
  usePlayerStore.setState({ ...initialPlayerState, queue: [...initialPlayerState.queue] });
});

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  // Clean up audition handler.
  type WinExt = Window & { __cartAuditionHandler?: (track: Track) => void };
  delete (window as WinExt).__cartAuditionHandler;
});

describe('CartHotkeysBridge', () => {
  test('given letter key A > triggers slot 0', () => {
    const slots: (Track | null)[] = Array.from({ length: 16 }, () => null);
    slots[0] = mockTracks[0];
    freshCart(makeTab(slots));

    const { container, root } = mount();
    pressKey({ key: 'a' });
    expect(usePlayerStore.getState().currentTrack?.id).toBe(mockTracks[0].id);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    unmount(container, root);
  });

  test('given letter key B (slot 1 with track) > triggers slot 1', () => {
    const slots: (Track | null)[] = Array.from({ length: 16 }, () => null);
    slots[1] = mockTracks[1];
    freshCart(makeTab(slots));

    const { container, root } = mount();
    pressKey({ key: 'B' });
    expect(usePlayerStore.getState().currentTrack?.id).toBe(mockTracks[1].id);
    unmount(container, root);
  });

  test('given Shift+A > does NOT trigger', () => {
    const slots: (Track | null)[] = Array.from({ length: 16 }, () => null);
    slots[0] = mockTracks[0];
    freshCart(makeTab(slots));

    const { container, root } = mount();
    pressKey({ key: 'A', shiftKey: true });
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    unmount(container, root);
  });

  test('given Ctrl+A > does NOT trigger', () => {
    const slots: (Track | null)[] = Array.from({ length: 16 }, () => null);
    slots[0] = mockTracks[0];
    freshCart(makeTab(slots));

    const { container, root } = mount();
    pressKey({ key: 'a', ctrlKey: true });
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    unmount(container, root);
  });

  test('given typing into input > does not fire', () => {
    const slots: (Track | null)[] = Array.from({ length: 16 }, () => null);
    slots[0] = mockTracks[0];
    freshCart(makeTab(slots));

    const { container, root } = mount();
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.focus();
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    });
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    unmount(container, root);
  });

  test('given digit 1 > triggers slot 26', () => {
    const slots: (Track | null)[] = Array.from({ length: 48 }, () => null);
    slots[26] = mockTracks[3];
    freshCart(makeTab(slots));

    const { container, root } = mount();
    pressKey({ key: '1', code: 'Digit1' });
    expect(usePlayerStore.getState().currentTrack?.id).toBe(mockTracks[3].id);
    unmount(container, root);
  });

  test('given F1 > triggers slot 36', () => {
    const slots: (Track | null)[] = Array.from({ length: 48 }, () => null);
    slots[36] = mockTracks[5];
    freshCart(makeTab(slots));

    const { container, root } = mount();
    pressKey({ key: 'F1' });
    expect(usePlayerStore.getState().currentTrack?.id).toBe(mockTracks[5].id);
    unmount(container, root);
  });

  test('given empty slot > does not call play', () => {
    const slots: (Track | null)[] = Array.from({ length: 16 }, () => null);
    freshCart(makeTab(slots));
    const { container, root } = mount();
    pressKey({ key: 'a' });
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    unmount(container, root);
  });

  test('given audition mode > calls preview handler instead of main player', () => {
    const slots: (Track | null)[] = Array.from({ length: 16 }, () => null);
    slots[0] = mockTracks[0];
    freshCart(makeTab(slots), true);
    const handler = vi.fn();
    type WinExt = Window & { __cartAuditionHandler?: (track: Track) => void };
    (window as WinExt).__cartAuditionHandler = handler;

    const { container, root } = mount();
    pressKey({ key: 'a' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: mockTracks[0].id }));
    // Main player should be untouched when audition handler intercepted.
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    unmount(container, root);
  });

  test('given unmapped key > does nothing', () => {
    const slots: (Track | null)[] = Array.from({ length: 16 }, () => null);
    slots[0] = mockTracks[0];
    freshCart(makeTab(slots));
    const { container, root } = mount();
    pressKey({ key: '/', code: 'Slash' });
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    unmount(container, root);
  });
});
