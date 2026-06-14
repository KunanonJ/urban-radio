import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Playlist } from '@/lib/types';

vi.mock('@/lib/catalog-queries', () => ({
  useCatalogPlaylists: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'playlists.title': 'Playlists',
        'playlists.newPlaylist': 'New playlist',
        'emptyStates.playlists.title': 'No playlists yet',
        'emptyStates.playlists.description': 'Create a playlist to organise your library.',
        'emptyStates.playlists.action': 'Create playlist',
      };
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

import PlaylistsPage from './PlaylistsPage';
import { useCatalogPlaylists } from '@/lib/catalog-queries';

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

function setPlaylistsData(data: Playlist[] | undefined) {
  vi.mocked(useCatalogPlaylists).mockReturnValue({ data } as ReturnType<typeof useCatalogPlaylists>);
}

const rendered: Rendered[] = [];

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
  vi.mocked(useCatalogPlaylists).mockReset();
});

function textIn(container: HTMLElement, text: string): boolean {
  return (container.textContent ?? '').includes(text);
}

describe('PlaylistsPage', () => {
  test('given API returns no playlists > renders EmptyState with playlists copy', () => {
    setPlaylistsData([]);
    const r = renderPage(<PlaylistsPage />);
    rendered.push(r);
    expect(textIn(r.container, 'No playlists yet')).toBe(true);
    expect(textIn(r.container, 'Create a playlist to organise your library.')).toBe(true);
    expect(r.container.querySelectorAll('a[href^="/app/playlist/"]').length).toBe(0);
  });

  test('given API data undefined > renders EmptyState (no mock fallback)', () => {
    setPlaylistsData(undefined);
    const r = renderPage(<PlaylistsPage />);
    rendered.push(r);
    expect(r.container.querySelectorAll('a[href^="/app/playlist/"]').length).toBe(0);
    expect(textIn(r.container, 'No playlists yet')).toBe(true);
  });

  test('given API returns playlists > renders playlist cards', () => {
    const playlists: Playlist[] = [
      {
        id: 'p1',
        title: 'Morning Mix',
        description: 'AM tunes',
        artwork: 'x.png',
        trackCount: 5,
        duration: 600,
        tracks: [],
        createdBy: 'test',
        isPublic: true,
      },
      {
        id: 'p2',
        title: 'Evening Chill',
        description: 'PM tunes',
        artwork: 'y.png',
        trackCount: 8,
        duration: 900,
        tracks: [],
        createdBy: 'test',
        isPublic: true,
      },
    ];
    setPlaylistsData(playlists);
    const r = renderPage(<PlaylistsPage />);
    rendered.push(r);
    expect(textIn(r.container, 'Morning Mix')).toBe(true);
    expect(textIn(r.container, 'Evening Chill')).toBe(true);
    expect(textIn(r.container, 'No playlists yet')).toBe(false);
    expect(r.container.querySelectorAll('a[href^="/app/playlist/"]').length).toBe(2);
  });
});
