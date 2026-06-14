import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CartPage from '@/views/app/CartPage';
import {
  CART_SLOT_COUNT,
  MIN_GRID,
  type CartTab,
  useCartStore,
} from '@/lib/cart-store';
import { usePlayerStore } from '@/lib/store';
import { mockTracks } from '@/lib/mock-data';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('next/image', () => ({
  default: ({ alt, src, width, height, className }: ComponentProps<'img'> & { width?: number; height?: number }) =>
    React.createElement('img', { alt, src: src as string, width, height, className }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown> & { defaultValue?: string }) => {
      const map: Record<string, string> = {
        'cartWall.title': 'Cart wall',
        'cartWall.subtitle': 'Touch + hotkey board.',
        'cartWall.newTab': 'New tab',
        'cartWall.renameTab': 'Rename tab',
        'cartWall.deleteTab': 'Delete tab',
        'cartWall.resizeTab': 'Resize',
        'cartWall.auditionMode': 'Audition mode',
        'cartWall.auditionHint': 'Audition plays slots locally.',
        'cartWall.gridSize': 'Grid size',
        'cartWall.cols': 'Columns',
        'cartWall.rows': 'Rows',
        'cartWall.hotkeyHint': 'Press the highlighted key.',
        'cartWall.emptyState.title': 'Cart wall is empty',
        'cartWall.emptyState.description': 'Drag tracks…',
        'cartWall.emptyState.action': 'Open library',
        'cart.assignPlaceholder': 'Assign track…',
      };
      let value = map[key] ?? opts?.defaultValue ?? key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          if (k === 'defaultValue') continue;
          value = value.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
        }
      }
      return value;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/lib/library', () => ({
  useMergedTracks: () => mockTracks.slice(0, 5),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverStub }).ResizeObserver ??= ResizeObserverStub;
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

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

function makeFreshTab(): CartTab {
  return {
    id: 'tab-fresh',
    name: 'Main',
    gridCols: 4,
    gridRows: 3,
    slots: Array.from({ length: CART_SLOT_COUNT }, () => null),
  };
}

function freshState() {
  const tab = makeFreshTab();
  useCartStore.setState({
    tabs: [tab],
    activeTabId: tab.id,
    auditionMode: false,
    slots: tab.slots,
  });
  usePlayerStore.setState({ ...initialPlayerState, queue: [...initialPlayerState.queue] });
  pushMock.mockReset();
}

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<CartPage />);
  });
  return { container, root };
}

function unmount(container: HTMLDivElement, root: Root) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

beforeEach(() => {
  freshState();
});

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  document.querySelectorAll('[data-radix-popper-content-wrapper]').forEach((el) => el.remove());
});

describe('CartPage', () => {
  test('given fresh store > renders default tab with 12 empty slots', () => {
    const { container, root } = mount();
    const tiles = container.querySelectorAll('[data-testid^="cart-tile-"][data-slot-index]');
    expect(tiles).toHaveLength(CART_SLOT_COUNT);
    unmount(container, root);
  });

  test('given empty store > renders empty state with action', () => {
    const { container, root } = mount();
    // EmptyState renders its title as <h2> so it sits one level below the
    // page <h1>. See `src/components/ui/empty-state.tsx`.
    const empty = Array.from(container.querySelectorAll('h2')).find((h) =>
      (h.textContent ?? '').includes('Cart wall is empty'),
    );
    expect(empty).toBeTruthy();
    unmount(container, root);
  });

  test('given track in slot > does not show empty state', () => {
    useCartStore.getState().setSlot(0, mockTracks[0]);
    const { container, root } = mount();
    const empty = Array.from(container.querySelectorAll('h2')).find((h) =>
      (h.textContent ?? '').includes('Cart wall is empty'),
    );
    expect(empty).toBeFalsy();
    unmount(container, root);
  });

  test('given audition toggle click > updates store', () => {
    const { container, root } = mount();
    const toggle = container.querySelector('[data-testid="cart-audition-toggle"]') as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useCartStore.getState().auditionMode).toBe(true);
    unmount(container, root);
  });

  test('given click on populated slot > calls player.play', () => {
    useCartStore.getState().setSlot(0, mockTracks[0]);
    const { container, root } = mount();
    const tile = container.querySelector('[data-testid="cart-tile-0"]') as HTMLButtonElement | null;
    act(() => {
      tile?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(usePlayerStore.getState().currentTrack?.id).toBe(mockTracks[0].id);
    unmount(container, root);
  });

  test('given resize action > tab updates to chosen cols', () => {
    const { container, root } = mount();
    const tabId = useCartStore.getState().tabs[0].id;
    // We exercise the store directly (the Select uses Radix portal which is awkward in jsdom).
    act(() => {
      useCartStore.getState().resizeTab(tabId, 6, 4);
    });
    // Re-render reads the new tab dimensions.
    expect(useCartStore.getState().tabs[0].gridCols).toBe(6);
    const grid = container.querySelector('[data-testid="cart-grid"]');
    expect(grid?.getAttribute('data-cols')).toBe('6');
    unmount(container, root);
  });

  test('given current track matches a slot > slot shows data-state="playing"', () => {
    useCartStore.getState().setSlot(2, mockTracks[2]);
    usePlayerStore.setState({ currentTrack: mockTracks[2], isPlaying: true });
    const { container, root } = mount();
    const tile = container.querySelector('[data-testid="cart-tile-2"]');
    expect(tile?.getAttribute('data-state')).toBe('playing');
    unmount(container, root);
  });

  test('given empty state action > pushes to /app/tracks', () => {
    const { container, root } = mount();
    const actionBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Open library'),
    );
    expect(actionBtn).toBeTruthy();
    act(() => {
      actionBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(pushMock).toHaveBeenCalledWith('/app/tracks');
    unmount(container, root);
  });

  test('given MIN_GRID > grid never goes below 4x4', () => {
    // Programmatic check: page must respect store-level clamp.
    const tabId = useCartStore.getState().tabs[0].id;
    act(() => {
      useCartStore.getState().resizeTab(tabId, 1, 1);
    });
    expect(useCartStore.getState().tabs[0].gridCols).toBe(MIN_GRID);
  });
});
