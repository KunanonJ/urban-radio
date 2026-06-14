import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'reports.trends.topHours': 'Top hours',
        'reports.empty.title': 'No data',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

const barChartCalls: Array<Record<string, unknown>> = [];
vi.mock('@tremor/react', () => ({
  BarChart: (props: Record<string, unknown>) => {
    barChartCalls.push(props);
    const data = (props.data as Array<{ hour: string; plays: number }>) ?? [];
    return (
      <div data-testid="tremor-bar-chart" data-bars={data.length}>
        {data.map((d, i) => (
          <span key={i} data-testid={`tremor-bar-hour-${d.hour}`}>{`${d.hour}:${d.plays}`}</span>
        ))}
      </div>
    );
  },
}));

import { TopHoursChart } from './TopHoursChart';
import type { TopHourBucket } from '@/lib/reports-queries';

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
  barChartCalls.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

function makeFullDay(): TopHourBucket[] {
  return Array.from({ length: 24 }, (_, h) => ({ hour: h, plays: h + 1 }));
}

describe('TopHoursChart', () => {
  test('given 24 buckets > renders 24 bars with 00..23 labels', () => {
    const r = render(<TopHoursChart data={makeFullDay()} />);
    rendered.push(r);
    const chart = r.container.querySelector(
      '[data-testid="reports-top-hours-chart"]',
    );
    expect(chart).toBeTruthy();
    expect(chart?.getAttribute('data-bars')).toBe('24');
    // Labels 00 and 23 should be present.
    expect(
      r.container.querySelector('[data-testid="tremor-bar-hour-00"]'),
    ).toBeTruthy();
    expect(
      r.container.querySelector('[data-testid="tremor-bar-hour-23"]'),
    ).toBeTruthy();
  });

  test('given partial buckets > zero-fills to 24 entries', () => {
    const r = render(
      <TopHoursChart
        data={[
          { hour: 0, plays: 3 },
          { hour: 12, plays: 50 },
        ]}
      />,
    );
    rendered.push(r);
    const chart = r.container.querySelector(
      '[data-testid="reports-top-hours-chart"]',
    );
    expect(chart?.getAttribute('data-bars')).toBe('24');
    const passed = barChartCalls[0];
    expect(passed.index).toBe('hour');
    expect(passed.categories).toEqual(['plays']);
  });

  test('given empty data > renders empty hint', () => {
    const r = render(<TopHoursChart data={[]} />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-top-hours-empty"]'),
    ).toBeTruthy();
    expect(
      r.container.querySelector('[data-testid="reports-top-hours-chart"]'),
    ).toBeNull();
  });

  test('given isLoading > renders skeleton', () => {
    const r = render(<TopHoursChart isLoading />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-top-hours-skeleton"]'),
    ).toBeTruthy();
  });
});
