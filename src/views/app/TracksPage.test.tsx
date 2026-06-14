import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Track } from '@/lib/types';

// Mock virtualization deps before importing the page.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => {
  (globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverStub }).ResizeObserver ??=
    ResizeObserverStub;

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.testid === 'virtualized-track-table-scroll') return 640;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.testid === 'virtualized-track-table-scroll') return 1024;
      return 0;
    },
  });
});

// Mock the i18n hook: return last segment of key for any unknown key, supply
// specific translations the test asserts on.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => {
      const map: Record<string, string> = {
        'tracks.title': 'Tracks',
        'tracks.count': `${opts?.count ?? 0} tracks`,
        'tracks.addToQueue': 'Add to queue',
        'tracks.addedToQueue': `Added ${opts?.count ?? 0} tracks to queue`,
        'tracks.clearSelection': 'Clear',
        'tracks.selectedCount': `${opts?.count ?? 0} selected`,
        'emptyStates.tracks.title': 'No tracks yet',
        'emptyStates.tracks.description': 'Upload audio or wait for the catalog to sync.',
        'emptyStates.tracks.action': 'Upload tracks',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// Mock toast — we don't need to assert on it, just keep it silent.
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    message: vi.fn(),
  },
}));

// Mock the catalog hook directly so we never hit the real network.
vi.mock('@/lib/catalog-queries', () => ({
  useInfiniteCatalogTracks: vi.fn(),
}));

// Stub the shadcn Select with a native select for testability (same shape as
// FacetedFilterBar.test.tsx — the page renders the bar internally).
vi.mock('@/components/ui/select', () => {
  type SelectProps = {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  };
  function Select({ value, onValueChange, children }: SelectProps) {
    return (
      <select
        data-testid="select-mock"
        value={value}
        onChange={(e) => onValueChange(e.currentTarget.value)}
      >
        {children}
      </select>
    );
  }
  function SelectTrigger({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }
  function SelectContent({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }
  function SelectValue() {
    return null;
  }
  function SelectItem({ value, children }: { value: string; children: ReactNode }) {
    return <option value={value}>{children}</option>;
  }
  return { Select, SelectTrigger, SelectContent, SelectValue, SelectItem };
});

import TracksPage from './TracksPage';
import { useInfiniteCatalogTracks } from '@/lib/catalog-queries';
import { usePlayerStore } from '@/lib/store';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function renderPage(element: ReactNode): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

function cleanup({ container, root }: Rendered) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

function makeTrack(overrides: Partial<Track> & { id: string }): Track {
  return {
    id: overrides.id,
    title: overrides.title ?? `Title ${overrides.id}`,
    artist: overrides.artist ?? 'Some Artist',
    artistId: overrides.artistId ?? 'artist-x',
    album: overrides.album ?? 'Some Album',
    albumId: overrides.albumId ?? 'album-x',
    duration: overrides.duration ?? 180,
    artwork: overrides.artwork ?? '',
    source: overrides.source ?? 'cloud',
    genre: overrides.genre ?? 'Pop',
    year: overrides.year ?? 2024,
    trackNumber: overrides.trackNumber ?? 1,
    dateAdded: overrides.dateAdded ?? '2024-01-01T00:00:00Z',
  };
}

type HookReturn = {
  data: { pages: { tracks: Track[]; meta: { nextCursor: string | null; limit: number } }[] } | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  fetchNextPage: ReturnType<typeof vi.fn>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

function setHookResult(partial: Partial<HookReturn>) {
  const base: HookReturn = {
    data: { pages: [{ tracks: [], meta: { nextCursor: null, limit: 50 } }] },
    isLoading: false,
    isFetching: false,
    isError: false,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    refetch: vi.fn(),
  };
  const merged = { ...base, ...partial };
  vi.mocked(useInfiniteCatalogTracks).mockReturnValue(merged as unknown as ReturnType<
    typeof useInfiniteCatalogTracks
  >);
  return merged;
}

const rendered: Rendered[] = [];

// Preserve and reset the player store between tests so toast/queue side effects
// don't leak.
const initialPlayer = usePlayerStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
  usePlayerStore.setState({
    ...initialPlayer,
    queue: [...initialPlayer.queue],
    currentTrack: initialPlayer.currentTrack,
  });
});

function textIn(container: HTMLElement, text: string): boolean {
  return (container.textContent ?? '').includes(text);
}

describe('TracksPage', () => {
  test('given API returns empty > renders EmptyState with tracks copy (no mock fallback)', () => {
    setHookResult({ data: { pages: [{ tracks: [], meta: { nextCursor: null, limit: 50 } }] } });
    const r = renderPage(<TracksPage />);
    rendered.push(r);

    expect(textIn(r.container, 'No tracks yet')).toBe(true);
    expect(textIn(r.container, 'Upload audio or wait for the catalog to sync.')).toBe(true);
    expect(r.container.querySelector('[data-testid="virtualized-track-table"]')).toBeNull();
  });

  test('given API returns 50 tracks > renders virtualized table', () => {
    const tracks = Array.from({ length: 50 }, (_, i) => makeTrack({ id: `t-${i}`, title: `Track ${i}` }));
    setHookResult({ data: { pages: [{ tracks, meta: { nextCursor: 'cursor-2', limit: 50 } }] } });

    const r = renderPage(<TracksPage />);
    rendered.push(r);

    expect(r.container.querySelector('[data-testid="virtualized-track-table"]')).not.toBeNull();
    const rows = r.container.querySelectorAll('[data-testid="vt-row"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50);
  });

  test('given loading > renders Skeleton rows', () => {
    setHookResult({ data: undefined, isLoading: true });
    const r = renderPage(<TracksPage />);
    rendered.push(r);

    expect(r.container.querySelector('[data-testid="tp-loading"]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid="virtualized-track-table"]')).toBeNull();
  });

  test('given filter changed > refetches with new params', () => {
    const tracks = Array.from({ length: 5 }, (_, i) => makeTrack({ id: `t-${i}` }));
    setHookResult({ data: { pages: [{ tracks, meta: { nextCursor: null, limit: 50 } }] } });

    const r = renderPage(<TracksPage />);
    rendered.push(r);

    const selects = r.container.querySelectorAll('[data-testid="select-mock"]');
    expect(selects.length).toBeGreaterThan(0);
    // The first select is the category facet inside the FacetedFilterBar.
    const categorySelect = selects[0] as HTMLSelectElement;

    // Simulate change. The page re-renders TracksPage with new filters, which
    // calls useInfiniteCatalogTracks again with the updated argument.
    vi.mocked(useInfiniteCatalogTracks).mockClear();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      // No options exist beyond the default in this render (no categories prop),
      // so simulate a file-type change instead.
      const fileTypeSelect = selects[1] as HTMLSelectElement;
      setter?.call(fileTypeSelect, 'mp3');
      fileTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(vi.mocked(useInfiniteCatalogTracks).mock.calls.length).toBeGreaterThan(0);
    const lastCallArgs = vi.mocked(useInfiniteCatalogTracks).mock.calls.at(-1);
    expect(lastCallArgs?.[0]).toEqual({ fileType: 'mp3' });

    // Suppress unused variable warning — categorySelect proves the bar is wired.
    expect(categorySelect.tagName).toBe('SELECT');
  });

  test('given hasNextPage and table scroll near end > calls fetchNextPage', () => {
    // Use a smaller list so the rendered virtual window reaches the end.
    const tracks = Array.from({ length: 5 }, (_, i) => makeTrack({ id: `t-${i}` }));
    const fetchNextPage = vi.fn();
    setHookResult({
      data: { pages: [{ tracks, meta: { nextCursor: 'next', limit: 50 } }] },
      hasNextPage: true,
      fetchNextPage,
    });

    const r = renderPage(<TracksPage />);
    rendered.push(r);

    const scroll = r.container.querySelector(
      '[data-testid="virtualized-track-table-scroll"]',
    ) as HTMLElement | null;
    expect(scroll).not.toBeNull();

    act(() => {
      scroll?.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    expect(fetchNextPage).toHaveBeenCalled();
  });

  test('given a row selected > shows bulk-action toolbar with count', () => {
    const tracks = Array.from({ length: 3 }, (_, i) => makeTrack({ id: `t-${i}` }));
    setHookResult({ data: { pages: [{ tracks, meta: { nextCursor: null, limit: 50 } }] } });

    const r = renderPage(<TracksPage />);
    rendered.push(r);

    // Pick the first visible row's checkbox.
    const firstId = (r.container.querySelector('[data-testid="vt-row"]') as HTMLElement | null)?.getAttribute(
      'data-track-id',
    );
    expect(firstId).toBeTruthy();
    const cb = r.container.querySelector(`[data-testid="vt-row-checkbox-${firstId}"]`) as HTMLInputElement | null;
    expect(cb).not.toBeNull();

    act(() => {
      cb?.click();
    });

    const toolbar = r.container.querySelector('[data-testid="tp-bulk-toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(textIn(toolbar as HTMLElement, '1 selected')).toBe(true);
  });

  test('given preview pane and hover > renders the track title and artist', () => {
    const tracks = [
      makeTrack({ id: 't-1', title: 'Hovered Title', artist: 'Hovered Artist' }),
      makeTrack({ id: 't-2', title: 'Other' }),
    ];
    setHookResult({ data: { pages: [{ tracks, meta: { nextCursor: null, limit: 50 } }] } });

    const r = renderPage(<TracksPage />);
    rendered.push(r);

    // No preview content until hover happens.
    expect(r.container.querySelector('[data-testid="track-preview-pane"]')).toBeNull();

    const row = r.container.querySelector('[data-testid="vt-row"]') as HTMLElement | null;
    expect(row).not.toBeNull();
    act(() => {
      // React 18 onMouseEnter is implemented via mouseover.
      row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    const pane = r.container.querySelector('[data-testid="track-preview-pane"]');
    expect(pane).not.toBeNull();
    expect(textIn(pane as HTMLElement, 'Hovered Title')).toBe(true);
    expect(textIn(pane as HTMLElement, 'Hovered Artist')).toBe(true);
  });

  test('given preview pane Play button > calls player play with that track', () => {
    const tracks = [makeTrack({ id: 't-1', title: 'Click Me' })];
    setHookResult({ data: { pages: [{ tracks, meta: { nextCursor: null, limit: 50 } }] } });

    // Spy the player store action.
    const playSpy = vi.fn();
    usePlayerStore.setState({ play: playSpy as unknown as typeof initialPlayer.play });

    const r = renderPage(<TracksPage />);
    rendered.push(r);

    // Hover to surface the pane.
    const row = r.container.querySelector('[data-testid="vt-row"]') as HTMLElement | null;
    act(() => {
      row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    const playBtn = r.container.querySelector('[data-testid="tpp-play"]') as HTMLButtonElement | null;
    expect(playBtn).not.toBeNull();
    act(() => {
      playBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // The pane wires onPlay -> play(track). play was already invoked by the
    // row click via playSpy if the row click had fired — but here we only
    // clicked the preview Play button.
    expect(playSpy).toHaveBeenCalled();
    expect(playSpy.mock.calls.at(-1)?.[0]).toMatchObject({ id: 't-1' });
  });

  test('given null preview > pane renders nothing', () => {
    const tracks = [makeTrack({ id: 't-1' })];
    setHookResult({ data: { pages: [{ tracks, meta: { nextCursor: null, limit: 50 } }] } });

    const r = renderPage(<TracksPage />);
    rendered.push(r);

    // No hover yet → pane absent.
    expect(r.container.querySelector('[data-testid="track-preview-pane"]')).toBeNull();
  });
});
