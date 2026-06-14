import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Album } from '@/lib/types';

const pushMock = vi.fn();
const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'missing' }),
  useRouter: () => ({
    push: pushMock,
    replace: replaceMock,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const useMergedAlbumsMock = vi.fn<() => Album[]>();

vi.mock('@/lib/library', () => ({
  useMergedAlbums: () => useMergedAlbumsMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { artist?: string }) => {
      const map: Record<string, string> = {
        'albumDetail.kind': 'Album',
        'albumDetail.play': 'Play',
        'albumDetail.shuffle': 'Shuffle',
      };
      if (key === 'albumDetail.moreBy') return `More by ${opts?.artist ?? ''}`;
      // Empty-state copy from i18n bundle:
      const emptyMap: Record<string, string> = {
        'emptyStates.albumNotFound.title': 'Album not found',
        'emptyStates.albumNotFound.description': 'This album may have been removed or never existed.',
        'emptyStates.albumNotFound.action': 'Back to albums',
      };
      return map[key] ?? emptyMap[key] ?? key;
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
vi.mock('@/components/AlbumCard', () => ({
  AlbumCard: () => null,
}));

import AlbumDetailPage from '@/views/app/AlbumDetailPage';
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
  replaceMock.mockReset();
  useMergedAlbumsMock.mockReset();
  usePlayerStore.setState({ ...initialPlayerState, queue: [...initialPlayerState.queue] });
});

describe('AlbumDetailPage', () => {
  test('given API returns null > renders albumNotFound EmptyState', () => {
    // Empty merged list → no match for 'missing' AND no fallback element to synthesise.
    useMergedAlbumsMock.mockReturnValue([]);

    const r = render(<AlbumDetailPage />);
    rendered.push(r);

    expect(findByText(r.container, 'Album not found')).not.toBeNull();

    const button = Array.from(r.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Back to albums',
    );
    expect(button).toBeTruthy();

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(pushMock).toHaveBeenCalledWith('/app/library/albums');
  });

  test('given API returns album with no tracks > Play button is disabled', () => {
    const album: Album = {
      id: 'missing',
      title: 'Sparse',
      artist: 'Nobody',
      artistId: 'an',
      artwork: 'https://example.com/a.jpg',
      year: 2024,
      genre: 'Test',
      trackCount: 0,
      tracks: [],
      source: 'local',
    };
    useMergedAlbumsMock.mockReturnValue([album]);

    const r = render(<AlbumDetailPage />);
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
