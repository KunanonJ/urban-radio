import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Track } from '@/lib/types';
import { VirtualizedTrackTable } from './VirtualizedTrackTable';

// TanStack Virtual relies on ResizeObserver and a non-zero scroll-element rect.
// jsdom ships neither — `offsetHeight` is always 0 and there is no
// ResizeObserver — so we stub both before each render. The virtualizer reads
// the scroll element rect from `offsetWidth`/`offsetHeight` (see
// virtual-core's `getRect`), not from `getBoundingClientRect`.
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

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    mediaUrl: overrides.mediaUrl,
    cloudKey: overrides.cloudKey,
    contentHash: overrides.contentHash,
  };
}

function makeTracks(n: number): Track[] {
  return Array.from({ length: n }, (_, i) => makeTrack({ id: `t-${i}`, title: `Track ${i}` }));
}

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function renderTable(element: ReactNode): Rendered {
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

const rendered: Rendered[] = [];

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('VirtualizedTrackTable', () => {
  test('given 1000 tracks > renders only the virtualized window (far fewer than 1000)', () => {
    const tracks = makeTracks(1000);
    const noop = () => {};

    const r = renderTable(
      <VirtualizedTrackTable
        tracks={tracks}
        selected={new Set()}
        onSelectionChange={noop}
        onPlayTrack={noop}
        onPreviewTrack={noop}
      />,
    );
    rendered.push(r);

    const rows = r.container.querySelectorAll('[data-testid="vt-row"]');
    // Containers in jsdom have 0 layout height by default, but we seed an
    // initial rect of 640px which yields ~13 rows + overscan ≈ 21. Either way,
    // we should be well under the total dataset size.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
  });

  test('given row click > calls onPlayTrack with that track', () => {
    const tracks = makeTracks(5);
    const onPlay = vi.fn();

    const r = renderTable(
      <VirtualizedTrackTable
        tracks={tracks}
        selected={new Set()}
        onSelectionChange={() => {}}
        onPlayTrack={onPlay}
        onPreviewTrack={() => {}}
      />,
    );
    rendered.push(r);

    const rows = Array.from(r.container.querySelectorAll('[data-testid="vt-row"]'));
    expect(rows.length).toBeGreaterThan(0);
    const first = rows[0] as HTMLElement;
    const trackId = first.getAttribute('data-track-id');
    expect(trackId).not.toBeNull();

    act(() => {
      first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay.mock.calls[0][0]).toMatchObject({ id: trackId });
  });

  test('given row checkbox toggle > calls onSelectionChange with id added', () => {
    const tracks = makeTracks(5);
    const onSel = vi.fn();

    const r = renderTable(
      <VirtualizedTrackTable
        tracks={tracks}
        selected={new Set()}
        onSelectionChange={onSel}
        onPlayTrack={() => {}}
        onPreviewTrack={() => {}}
      />,
    );
    rendered.push(r);

    const firstId = (r.container.querySelector('[data-testid="vt-row"]') as HTMLElement | null)?.getAttribute(
      'data-track-id',
    );
    expect(firstId).toBeTruthy();

    const checkbox = r.container.querySelector(
      `[data-testid="vt-row-checkbox-${firstId}"]`,
    ) as HTMLInputElement | null;
    expect(checkbox).not.toBeNull();

    act(() => {
      // React listens to `change`, but `<input type=checkbox>` change events
      // also need the `checked` state mutated first.
      if (checkbox) {
        checkbox.click();
      }
    });

    expect(onSel).toHaveBeenCalledTimes(1);
    const passed = onSel.mock.calls[0][0] as Set<string>;
    expect(passed instanceof Set).toBe(true);
    expect(passed.has(firstId!)).toBe(true);
  });

  test('given empty list > renders nothing (parent handles EmptyState)', () => {
    const r = renderTable(
      <VirtualizedTrackTable
        tracks={[]}
        selected={new Set()}
        onSelectionChange={() => {}}
        onPlayTrack={() => {}}
        onPreviewTrack={() => {}}
      />,
    );
    rendered.push(r);

    expect(r.container.querySelector('[data-testid="virtualized-track-table"]')).toBeNull();
  });

  test('given row hover > calls onPreviewTrack with that track', () => {
    const tracks = makeTracks(3);
    const onPreview = vi.fn();

    const r = renderTable(
      <VirtualizedTrackTable
        tracks={tracks}
        selected={new Set()}
        onSelectionChange={() => {}}
        onPlayTrack={() => {}}
        onPreviewTrack={onPreview}
      />,
    );
    rendered.push(r);

    const first = r.container.querySelector('[data-testid="vt-row"]') as HTMLElement | null;
    expect(first).not.toBeNull();

    // React 18 implements onMouseEnter on top of native mouseover/mouseout
    // (no onMouseEnter delegation) — synthesize via mouseover so the synthetic
    // handler fires in jsdom.
    act(() => {
      first?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview.mock.calls[0][0]).toMatchObject({ id: first?.getAttribute('data-track-id') });
  });
});
