import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// IMPORTANT: declare mocks before importing the SUT so vi hoists them ahead of the module.
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

const useCatalogArtistMock = vi.fn();

vi.mock('@/lib/catalog-queries', () => ({
  useCatalogArtist: (id: string | undefined) => useCatalogArtistMock(id),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'emptyStates.artistNotFound.title': 'Artist not found',
        'emptyStates.artistNotFound.description': 'This artist may have been removed or never existed.',
        'emptyStates.artistNotFound.action': 'Back to artists',
        'emptyStates.tracks.title': 'No tracks yet',
        'emptyStates.tracks.description': 'Upload audio or wait for the catalog to sync.',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// next/image renders an <img>; replace with a plain element to avoid jsdom layout work.
vi.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element -- test stub only; bypasses next/image
  default: ({ alt, src }: ComponentProps<'img'>) => <img alt={alt} src={src as string} />,
}));

// Sibling cards/rows are not relevant to these tests; keep them inert.
vi.mock('@/components/TrackRow', () => ({
  TrackRow: () => null,
}));
vi.mock('@/components/AlbumCard', () => ({
  AlbumCard: () => null,
}));
vi.mock('@/components/ArtistCard', () => ({
  ArtistCard: () => null,
}));

import ArtistDetailPage from '@/views/app/ArtistDetailPage';
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
  useCatalogArtistMock.mockReset();
  usePlayerStore.setState({ ...initialPlayerState, queue: [...initialPlayerState.queue] });
});

describe('ArtistDetailPage', () => {
  test('given API returns null > renders artistNotFound EmptyState', () => {
    useCatalogArtistMock.mockReturnValue({ data: null });

    const r = render(<ArtistDetailPage />);
    rendered.push(r);

    // EmptyState title from i18n: "Artist not found"
    expect(findByText(r.container, 'Artist not found')).not.toBeNull();

    // Action button label: "Back to artists"
    const button = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Back to artists',
    );
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(pushMock).toHaveBeenCalledWith('/app/library/artists');
  });

  test('given API returns artist with empty tracks > Play button is disabled', () => {
    useCatalogArtistMock.mockReturnValue({
      data: {
        id: 'missing',
        name: 'Lonely Artist',
        artwork: 'https://example.com/a.jpg',
        genres: ['Ambient'],
        albumCount: 0,
        trackCount: 0,
        tracks: [],
        albums: [],
      },
    });

    const r = render(<ArtistDetailPage />);
    rendered.push(r);

    const playButton = Array.from(r.container.querySelectorAll('button')).find((b) =>
      b.textContent?.toLowerCase().includes('play'),
    );
    expect(playButton).toBeTruthy();
    expect((playButton as HTMLButtonElement).disabled).toBe(true);
  });
});
