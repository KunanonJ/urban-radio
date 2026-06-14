import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Playlist } from '@/lib/types';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'missing' }),
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const useCatalogPlaylistMock = vi.fn();

vi.mock('@/lib/catalog-queries', () => ({
  useCatalogPlaylist: (id: string | undefined) => useCatalogPlaylistMock(id),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'emptyStates.playlistNotFound.title': 'Playlist not found',
        'emptyStates.playlistNotFound.description':
          'This playlist may have been removed or never existed.',
        'emptyStates.playlistNotFound.action': 'Back to playlists',
        'emptyStates.tracks.title': 'No tracks yet',
        'emptyStates.tracks.description': 'Upload audio or wait for the catalog to sync.',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element -- test stub only; bypasses next/image
  default: ({ alt, src }: ComponentProps<'img'>) => <img alt={alt} src={src as string} />,
}));

vi.mock('@/components/TrackRow', () => ({
  TrackRow: () => null,
}));

import PlaylistDetailPage from '@/views/app/PlaylistDetailPage';
import { usePlayerStore } from '@/lib/store';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function render(element: ReactNode): Rendered {
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

function findByText(container: HTMLElement, text: string): Element | null {
  const all = container.querySelectorAll('*');
  for (const el of Array.from(all)) {
    if (el.children.length === 0 && el.textContent?.trim() === text) {
      return el;
    }
  }
  return null;
}

const rendered: Rendered[] = [];

const initialPlayerState = (() => {
  const s = usePlayerStore.getState();
  return {
    currentTrack: s.currentTrack,
    isPlaying: s.isPlaying,
    progress: s.progress,
    queue: [...s.queue],
    queueIndex: s.queueIndex,
  };
})();

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
  pushMock.mockReset();
  useCatalogPlaylistMock.mockReset();
  usePlayerStore.setState({ ...initialPlayerState, queue: [...initialPlayerState.queue] });
});

describe('PlaylistDetailPage', () => {
  test('given API returns null > renders playlistNotFound EmptyState', () => {
    useCatalogPlaylistMock.mockReturnValue({ data: null });

    const r = render(<PlaylistDetailPage />);
    rendered.push(r);

    expect(findByText(r.container, 'Playlist not found')).not.toBeNull();

    const button = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Back to playlists',
    );
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(pushMock).toHaveBeenCalledWith('/app/library/playlists');
  });

  test('given API returns playlist with no tracks > Play button is disabled', () => {
    const playlist: Playlist = {
      id: 'missing',
      title: 'Sparse Playlist',
      description: '',
      artwork: 'https://example.com/p.jpg',
      trackCount: 0,
      duration: 0,
      tracks: [],
      createdBy: 'tester',
      isPublic: false,
    };
    useCatalogPlaylistMock.mockReturnValue({ data: playlist });

    const r = render(<PlaylistDetailPage />);
    rendered.push(r);

    const buttons = Array.from(r.container.querySelectorAll('button')) as HTMLButtonElement[];
    const playButton = buttons.find((b) => b.textContent?.trim() === 'Play');
    const shuffleButton = buttons.find((b) => b.textContent?.trim() === 'Shuffle');

    expect(playButton).toBeTruthy();
    expect(shuffleButton).toBeTruthy();
    expect(playButton!.disabled).toBe(true);
    expect(shuffleButton!.disabled).toBe(true);
  });
});
