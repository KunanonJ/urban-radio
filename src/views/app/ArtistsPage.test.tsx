import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Artist } from '@/lib/types';

// Mock TanStack Query hook directly — no QueryClientProvider needed.
vi.mock('@/lib/catalog-queries', () => ({
  useCatalogArtists: vi.fn(),
}));

// i18n: return key when no map match, supply emptyStates copy for assertions.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'artists.title': 'Artists',
        'emptyStates.artists.title': 'No artists yet',
        'emptyStates.artists.description': 'Artists will appear here as your library grows.',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// next/link minimal stub — avoids next router context.
vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

// framer-motion: render plain divs so we can query immediately.
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
      // Strip motion-only props (initial/animate/transition) — they leak to DOM otherwise.
      const safe = { ...props };
      delete safe.initial;
      delete safe.animate;
      delete safe.transition;
      return <div {...safe}>{children as ReactNode}</div>;
    },
  },
}));

import ArtistsPage from './ArtistsPage';
import { useCatalogArtists } from '@/lib/catalog-queries';

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

function setArtistsData(data: Artist[] | undefined) {
  // Mock the hook return shape — only `data` is used in ArtistsPage.
  vi.mocked(useCatalogArtists).mockReturnValue({ data } as ReturnType<typeof useCatalogArtists>);
}

const rendered: Rendered[] = [];

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
  vi.mocked(useCatalogArtists).mockReset();
});

function textIn(container: HTMLElement, text: string): boolean {
  return (container.textContent ?? '').includes(text);
}

describe('ArtistsPage', () => {
  test('given API returns no artists > renders EmptyState with artists copy', () => {
    setArtistsData([]);
    const r = renderPage(<ArtistsPage />);
    rendered.push(r);
    expect(textIn(r.container, 'No artists yet')).toBe(true);
    expect(textIn(r.container, 'Artists will appear here as your library grows.')).toBe(true);
    // No artist links rendered.
    expect(r.container.querySelectorAll('a[href^="/app/artist/"]').length).toBe(0);
  });

  test('given API data undefined (loading) > renders EmptyState (no mock fallback)', () => {
    setArtistsData(undefined);
    const r = renderPage(<ArtistsPage />);
    rendered.push(r);
    // No mock artists should leak through — we use `?? []` now.
    expect(r.container.querySelectorAll('a[href^="/app/artist/"]').length).toBe(0);
    expect(textIn(r.container, 'No artists yet')).toBe(true);
  });

  test('given API returns artists > renders artist cards', () => {
    const artists: Artist[] = [
      { id: 'a1', name: 'Artist One', artwork: 'x.png', genres: ['Pop'], albumCount: 1, trackCount: 5 },
      { id: 'a2', name: 'Artist Two', artwork: 'y.png', genres: ['Rock'], albumCount: 2, trackCount: 10 },
    ];
    setArtistsData(artists);
    const r = renderPage(<ArtistsPage />);
    rendered.push(r);
    expect(textIn(r.container, 'Artist One')).toBe(true);
    expect(textIn(r.container, 'Artist Two')).toBe(true);
    expect(textIn(r.container, 'No artists yet')).toBe(false);
    // Cards link to artist detail.
    const links = r.container.querySelectorAll('a[href^="/app/artist/"]');
    expect(links.length).toBe(2);
  });
});
