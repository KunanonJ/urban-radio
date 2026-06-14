import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'reports.trends.playsByDay': 'Plays by day',
        'reports.empty.title': 'No data for this range',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// Tremor AreaChart pulls in recharts which doesn't render meaningfully in jsdom.
// Stub it to record its props.
const areaChartCalls: Array<Record<string, unknown>> = [];
vi.mock('@tremor/react', () => ({
  AreaChart: (props: Record<string, unknown>) => {
    areaChartCalls.push(props);
    const data = (props.data as Array<{ day: string; plays: number }>) ?? [];
    return (
      <div data-testid="tremor-area-chart" data-points={data.length}>
        {data.map((d, i) => (
          <span key={i} data-testid={`tremor-area-row-${i}`}>{`${d.day}:${d.plays}`}</span>
        ))}
      </div>
    );
  },
}));

import { PlaysByDayChart } from './PlaysByDayChart';
import type { PlaysByDayBucket } from '@/lib/reports-queries';

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
  areaChartCalls.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

const SEVEN_DAYS: PlaysByDayBucket[] = [
  { day: '2026-04-24', plays: 10 },
  { day: '2026-04-25', plays: 18 },
  { day: '2026-04-26', plays: 7 },
  { day: '2026-04-27', plays: 22 },
  { day: '2026-04-28', plays: 31 },
  { day: '2026-04-29', plays: 12 },
  { day: '2026-04-30', plays: 19 },
];

describe('PlaysByDayChart', () => {
  test('given 7 days > renders AreaChart with 7 data points', () => {
    const r = render(<PlaysByDayChart data={SEVEN_DAYS} />);
    rendered.push(r);
    const chartWrap = r.container.querySelector(
      '[data-testid="reports-plays-by-day-chart"]',
    );
    expect(chartWrap).toBeTruthy();
    expect(chartWrap?.getAttribute('data-points')).toBe('7');
    expect(areaChartCalls.length).toBe(1);
    const passed = areaChartCalls[0];
    expect(Array.isArray(passed.data)).toBe(true);
    expect((passed.data as unknown[]).length).toBe(7);
    expect(passed.index).toBe('day');
    expect(passed.categories).toEqual(['plays']);
  });

  test('given empty data > renders empty hint, no chart', () => {
    const r = render(<PlaysByDayChart data={[]} />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-plays-by-day-empty"]'),
    ).toBeTruthy();
    expect(
      r.container.querySelector('[data-testid="reports-plays-by-day-chart"]'),
    ).toBeNull();
  });

  test('given all-zero plays > still renders empty hint', () => {
    const r = render(
      <PlaysByDayChart
        data={[
          { day: '2026-05-01', plays: 0 },
          { day: '2026-05-02', plays: 0 },
        ]}
      />,
    );
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-plays-by-day-empty"]'),
    ).toBeTruthy();
  });

  test('given isLoading > renders skeleton instead of chart', () => {
    const r = render(<PlaysByDayChart isLoading data={SEVEN_DAYS} />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-plays-by-day-skeleton"]'),
    ).toBeTruthy();
    expect(
      r.container.querySelector('[data-testid="reports-plays-by-day-chart"]'),
    ).toBeNull();
  });
});
