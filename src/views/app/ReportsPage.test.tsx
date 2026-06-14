import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

// Stub Tremor (used inside chart wrappers) so we don't pull recharts.
vi.mock('@tremor/react', () => ({
  AreaChart: (props: Record<string, unknown>) => {
    const data = (props.data as unknown[]) ?? [];
    return <div data-testid="tremor-area-chart" data-points={data.length} />;
  },
  BarChart: (props: Record<string, unknown>) => {
    const data = (props.data as unknown[]) ?? [];
    return <div data-testid="tremor-bar-chart" data-bars={data.length} />;
  },
}));

const overviewMock = vi.fn();
const playsByDayMock = vi.fn();
const topHoursMock = vi.fn();
const topTracksMock = vi.fn();

vi.mock('@/lib/reports-queries', () => ({
  useReportOverview: () => overviewMock(),
  useReportPlaysByDay: () => playsByDayMock(),
  useReportTopHours: () => topHoursMock(),
  useReportTopTracks: () => topTracksMock(),
}));

vi.mock('@/components/reports/RoyaltyExportPanel', () => ({
  RoyaltyExportPanel: (props: { from?: string; to?: string }) => (
    <div
      data-testid="royalty-export-panel-mock"
      data-from={props.from ?? ''}
      data-to={props.to ?? ''}
    />
  ),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

import { ReportsPage } from './ReportsPage';

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

function defaultQueryState<T>(data: T | undefined = undefined) {
  return {
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
    isSuccess: !!data,
    error: null,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  overviewMock.mockReturnValue(
    defaultQueryState({
      overview: {
        totalPlays: 1000,
        uniqueTitles: 100,
        daysWithActivity: 30,
        totalListeningHours: 50,
      },
      range: { from: 'x', to: 'y' },
    }),
  );
  playsByDayMock.mockReturnValue(
    defaultQueryState({
      days: [
        { day: '2026-05-01', plays: 5 },
        { day: '2026-05-02', plays: 8 },
      ],
      range: { from: 'x', to: 'y' },
    }),
  );
  topHoursMock.mockReturnValue(
    defaultQueryState({
      hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, plays: h })),
    }),
  );
  topTracksMock.mockReturnValue(
    defaultQueryState({
      tracks: [
        { title: 'Song', artist: 'Artist', plays: 10 },
      ],
      limit: 25,
      range: { from: 'x', to: 'y' },
    }),
  );
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('ReportsPage', () => {
  test('renders all 5 tab triggers', () => {
    const r = render(<ReportsPage />);
    rendered.push(r);
    for (const key of ['overview', 'trends', 'geography', 'milestones', 'royalty']) {
      expect(
        r.container.querySelector(`[data-testid="reports-tab-${key}"]`),
      ).toBeTruthy();
    }
  });

  test('defaults to Overview tab > shows OverviewCards', () => {
    const r = render(<ReportsPage />);
    rendered.push(r);
    expect(
      r.container.querySelector(
        '[data-testid="reports-tab-content-overview"]',
      ),
    ).toBeTruthy();
    expect(
      r.container.querySelector('[data-testid="reports-overview-cards"]'),
    ).toBeTruthy();
  });

  test('click Geography tab > shows EmptyState (coming soon)', () => {
    const r = render(<ReportsPage />);
    rendered.push(r);
    const trigger = r.container.querySelector(
      '[data-testid="reports-tab-geography"]',
    ) as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    act(() => {
      trigger.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 }),
      );
    });
    // After click, geography content visible.
    const content = r.container.querySelector(
      '[data-testid="reports-tab-content-geography"]',
    );
    expect(content).toBeTruthy();
    // EmptyState description rendered from i18n key (stub returns key).
    expect(content?.textContent ?? '').toContain('reports.geography.comingSoon');
  });

  test('click Royalty tab > renders RoyaltyExportPanel with current range', () => {
    const r = render(<ReportsPage />);
    rendered.push(r);
    const trigger = r.container.querySelector(
      '[data-testid="reports-tab-royalty"]',
    ) as HTMLButtonElement;
    act(() => {
      trigger.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, button: 0 }),
      );
    });
    const panel = r.container.querySelector(
      '[data-testid="royalty-export-panel-mock"]',
    );
    expect(panel).toBeTruthy();
    // DateRangePicker emitted on mount, so from/to should be populated.
    expect(panel?.getAttribute('data-from')).toBeTruthy();
    expect(panel?.getAttribute('data-to')).toBeTruthy();
  });

  test('range change > all hooks were invoked (refetch path)', () => {
    const r = render(<ReportsPage />);
    rendered.push(r);
    // Mount fires preset → all hooks ran ≥ once.
    expect(overviewMock).toHaveBeenCalled();
    expect(playsByDayMock).toHaveBeenCalled();
    expect(topHoursMock).toHaveBeenCalled();
    expect(topTracksMock).toHaveBeenCalled();
    overviewMock.mockClear();
    playsByDayMock.mockClear();
    topHoursMock.mockClear();
    topTracksMock.mockClear();
    // Click last7 preset → state updates → re-render runs hooks again.
    const last7 = r.container.querySelector(
      '[data-testid="reports-range-preset-last7"]',
    ) as HTMLButtonElement;
    act(() => {
      last7.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(overviewMock).toHaveBeenCalled();
    expect(playsByDayMock).toHaveBeenCalled();
    expect(topHoursMock).toHaveBeenCalled();
    expect(topTracksMock).toHaveBeenCalled();
  });
});
