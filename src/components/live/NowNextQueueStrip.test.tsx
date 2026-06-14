import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'liveStudio.now': 'Now playing',
        'liveStudio.next': 'Up next',
        'liveStudio.queue': 'Queue',
        'liveStudio.remaining': 'Remaining',
        'liveStudio.elapsed': 'Elapsed',
        'liveStudio.play': 'Play',
        'liveStudio.pause': 'Pause',
        'liveStudio.skip': 'Skip',
        'liveStudio.preload': 'Preload next',
        'liveStudio.emptyState.title': 'Nothing on air',
        'liveStudio.emptyState.description':
          'Start the queue or schedule a clock to bring the studio to life.',
        'liveStudio.emptyState.action': 'Open scheduler',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, ...props }: ComponentProps<'button'>) => <button {...props}>{children}</button>,
    div: ({ children, ...props }: ComponentProps<'div'>) => <div {...props}>{children}</div>,
  },
}));

// Skip the next/image optimizer; render a plain <img> in tests.
vi.mock('next/image', () => ({
  default: ({ src, alt = '' }: { src: string; alt?: string }) => {
    // eslint-disable-next-line @next/next/no-img-element -- test-only stub
    return <img src={src} alt={alt} />;
  },
}));

import { NowNextQueueStrip } from './NowNextQueueStrip';
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

function mount(element: React.ReactElement): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  const m = { container, root };
  mounted.push(m);
  return m;
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
});

describe('NowNextQueueStrip', () => {
  test('given no currentTrack > shows EmptyState (uses liveStudio.emptyState.* keys)', () => {
    usePlayerStore.setState({ currentTrack: null, queue: [], queueIndex: 0 });
    const { container } = mount(<NowNextQueueStrip />);
    const empty = container.querySelector('[data-testid="live-studio-empty-state"]');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('Nothing on air');
  });

  test('given currentTrack > renders title + artist', () => {
    const queue = [mockTracks[0], mockTracks[1], mockTracks[2]];
    usePlayerStore.setState({
      currentTrack: queue[0],
      queue,
      queueIndex: 0,
      isPlaying: false,
    });

    const { container } = mount(<NowNextQueueStrip />);
    const nowCard = container.querySelector('[data-testid="live-studio-now"]');
    expect(nowCard).not.toBeNull();
    expect(nowCard?.textContent).toContain(queue[0].title);
    expect(nowCard?.textContent).toContain(queue[0].artist);
  });

  test('given play button click > calls togglePlay', () => {
    const queue = [mockTracks[0], mockTracks[1]];
    usePlayerStore.setState({
      currentTrack: queue[0],
      queue,
      queueIndex: 0,
      isPlaying: false,
    });

    const { container } = mount(<NowNextQueueStrip />);
    const playBtn = container.querySelector(
      '[data-testid="live-studio-play"]',
    ) as HTMLButtonElement | null;
    expect(playBtn).not.toBeNull();

    act(() => {
      playBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  test('given skip button click > calls next', () => {
    const queue = [mockTracks[0], mockTracks[1], mockTracks[2]];
    usePlayerStore.setState({
      currentTrack: queue[0],
      queue,
      queueIndex: 0,
      isPlaying: true,
    });

    const { container } = mount(<NowNextQueueStrip />);
    const skipBtn = container.querySelector(
      '[data-testid="live-studio-skip"]',
    ) as HTMLButtonElement | null;
    expect(skipBtn).not.toBeNull();

    act(() => {
      skipBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(usePlayerStore.getState().queueIndex).toBe(1);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(queue[1].id);
  });

  test('given queueIndex 0 and 5 tracks > Next card shows queue[1]', () => {
    const queue = [
      mockTracks[0],
      mockTracks[1],
      mockTracks[2],
      mockTracks[3],
      mockTracks[4],
    ];
    usePlayerStore.setState({
      currentTrack: queue[0],
      queue,
      queueIndex: 0,
    });

    const { container } = mount(<NowNextQueueStrip />);
    const nextCard = container.querySelector('[data-testid="live-studio-next"]');
    expect(nextCard).not.toBeNull();
    expect(nextCard?.textContent).toContain(queue[1].title);
    expect(nextCard?.textContent).toContain(queue[1].artist);
  });

  test('given queue track click > calls playAtQueueIndex', () => {
    const queue = [
      mockTracks[0],
      mockTracks[1],
      mockTracks[2],
      mockTracks[3],
      mockTracks[4],
      mockTracks[5],
      mockTracks[6],
    ];
    usePlayerStore.setState({
      currentTrack: queue[0],
      queue,
      queueIndex: 0,
    });

    const { container } = mount(<NowNextQueueStrip />);
    // Queue list starts at queueIndex + 2 (so absolute index 2 is the first row).
    const row = container.querySelector('[data-testid="live-studio-queue-row-2"]');
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const next = usePlayerStore.getState();
    expect(next.queueIndex).toBe(2);
    expect(next.currentTrack?.id).toBe(queue[2].id);
  });
});
