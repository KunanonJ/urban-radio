import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Artist, Playlist } from '@/lib/types';

vi.mock('@/lib/catalog-queries', () => ({
  useCatalogArtists: vi.fn(),
  useCatalogPlaylists: vi.fn(),
}));

vi.mock('@/lib/library', () => ({
  useMergedAlbums: () => [],
}));

vi.mock('@/hooks/use-search-results', () => ({
  useSearchResults: () => [],
}));

// Search results table is exercised in its own tests; keep this isolated.
vi.mock('@/components/search/SearchResultsTable', () => ({
  SearchResultsTable: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'search.title': 'Search',
        'search.placeholder': 'What do you want to listen to?',
        'search.emptyHint': 'Search for songs, albums, artists, playlists, or ad-break rules',
        'search.sectionAll': 'Songs & ad breaks',
        'search.sectionAlbums': 'Albums',
        'search.sectionArtists': 'Artists',
        'search.sectionPlaylists': 'Playlists',
        'emptyStates.search.title': 'No results',
        'emptyStates.search.description': 'Try a different keyword or check spelling.',
      };
      if (key === 'search.noResults' && vars && typeof vars.query === 'string') {
        return `No results for "${vars.query}"`;
      }
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
      const safe = { ...props };
      delete safe.initial;
      delete safe.animate;
      delete safe.transition;
      return <div {...safe}>{children as ReactNode}</div>;
    },
  },
}));

import SearchPage from './SearchPage';
import { useCatalogArtists, useCatalogPlaylists } from '@/lib/catalog-queries';

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

function setData(artists: Artist[] | undefined, playlists: Playlist[] | undefined) {
  vi.mocked(useCatalogArtists).mockReturnValue({ data: artists } as ReturnType<typeof useCatalogArtists>);
  vi.mocked(useCatalogPlaylists).mockReturnValue({ data: playlists } as ReturnType<typeof useCatalogPlaylists>);
}

function typeInSearch(container: HTMLElement, value: string) {
  const input = container.querySelector('input[type="text"], input:not([type])') as HTMLInputElement | null;
  expect(input).not.toBeNull();
  act(() => {
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

const rendered: Rendered[] = [];

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
  vi.mocked(useCatalogArtists).mockReset();
  vi.mocked(useCatalogPlaylists).mockReset();
});

function textIn(container: HTMLElement, text: string): boolean {
  return (container.textContent ?? '').includes(text);
}

describe('SearchPage', () => {
  test('given empty query > does not render no-results EmptyState (shows initial hint)', () => {
    setData([], []);
    const r = renderPage(<SearchPage />);
    rendered.push(r);
    // Empty query: should show the "emptyHint" prompt, NOT the no-results EmptyState.
    expect(textIn(r.container, 'Search for songs, albums, artists, playlists, or ad-break rules')).toBe(true);
    expect(textIn(r.container, 'No results')).toBe(false);
  });

  test('given API returns no artists/playlists and a query > renders search EmptyState', () => {
    setData([], []);
    const r = renderPage(<SearchPage />);
    rendered.push(r);

    typeInSearch(r.container, 'abc');

    expect(textIn(r.container, 'No results')).toBe(true);
    expect(textIn(r.container, 'Try a different keyword or check spelling.')).toBe(true);
  });

  test('given matching artists and a query > renders artist results', () => {
    const artists: Artist[] = [
      { id: 'a1', name: 'Searchable', artwork: 'x.png', genres: ['Pop'], albumCount: 1, trackCount: 3 },
      { id: 'a2', name: 'Other', artwork: 'y.png', genres: ['Rock'], albumCount: 1, trackCount: 2 },
    ];
    setData(artists, []);
    const r = renderPage(<SearchPage />);
    rendered.push(r);

    typeInSearch(r.container, 'searchable');

    expect(textIn(r.container, 'Searchable')).toBe(true);
    expect(textIn(r.container, 'Other')).toBe(false);
    // No-results EmptyState should not appear when there's a match.
    expect(textIn(r.container, 'No results')).toBe(false);
  });
});
