import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'reports.trends.topTracks': 'Top tracks',
        'reports.empty.title': 'No data',
        'reports.overview.totalPlays': 'Plays',
        'voiceTracks.list.title': 'Title',
        'library.artist': 'Artist',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { TopTracksTable } from './TopTracksTable';
import type { TopTrackRow } from '@/lib/reports-queries';

(globalThis as typeof globalThis & {
  React?: typeof React;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).React = React;
(globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).IS_REACT_ACT_ENVIRONMENT = true;

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

const rendered: Rendered[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

const TRACKS: TopTrackRow[] = [
  { title: 'Alpha', artist: 'Beta', plays: 500 },
  { title: 'Charlie', artist: 'Delta', plays: 250 },
  { title: 'Echo', artist: 'Foxtrot', plays: 100 },
];

describe('TopTracksTable', () => {
  test('given tracks > renders all rows with title/artist/plays', () => {
    const r = render(<TopTracksTable tracks={TRACKS} />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-top-tracks-table"]'),
    ).toBeTruthy();
    const rows = r.container.querySelectorAll(
      '[data-testid^="reports-top-tracks-row-"]',
    );
    expect(rows.length).toBe(3);
    const text = r.container.textContent ?? '';
    expect(text).toContain('Alpha');
    expect(text).toContain('Beta');
    expect(text).toContain('Charlie');
    expect(text).toContain('500');
    expect(text).toContain('250');
  });

  test('given tracks > renders rank 1, 2, 3 in order', () => {
    const r = render(<TopTracksTable tracks={TRACKS} />);
    rendered.push(r);
    const rank0 = r.container.querySelector(
      '[data-testid="reports-top-tracks-rank-0"]',
    );
    const rank2 = r.container.querySelector(
      '[data-testid="reports-top-tracks-rank-2"]',
    );
    expect(rank0?.textContent).toContain('1');
    expect(rank2?.textContent).toContain('3');
  });

  test('given empty tracks > renders empty hint', () => {
    const r = render(<TopTracksTable tracks={[]} />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-top-tracks-empty"]'),
    ).toBeTruthy();
    expect(
      r.container.querySelector('[data-testid="reports-top-tracks-table"]'),
    ).toBeNull();
  });

  test('given isLoading > renders skeleton, not table', () => {
    const r = render(<TopTracksTable isLoading />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-top-tracks-skeleton"]'),
    ).toBeTruthy();
    expect(
      r.container.querySelector('[data-testid="reports-top-tracks-table"]'),
    ).toBeNull();
  });
});
