import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'reports.overview.totalPlays': 'Total plays',
        'reports.overview.uniqueTitles': 'Unique titles',
        'reports.overview.daysWithActivity': 'Active days',
        'reports.overview.totalListeningHours': 'Listening hours',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { OverviewCards } from './OverviewCards';
import type { ReportOverview } from '@/lib/reports-queries';

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

const SAMPLE: ReportOverview = {
  totalPlays: 12345,
  uniqueTitles: 412,
  daysWithActivity: 25,
  totalListeningHours: 64.3499,
};

describe('OverviewCards', () => {
  test('given overview > renders 4 cards with formatted numbers', () => {
    const r = render(<OverviewCards overview={SAMPLE} />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-overview-cards"]'),
    ).toBeTruthy();
    const cards = r.container.querySelectorAll(
      '[data-testid^="reports-overview-"]:not([data-testid="reports-overview-cards"])',
    );
    expect(cards.length).toBe(4);
    const text = r.container.textContent ?? '';
    expect(text).toContain('12,345');
    expect(text).toContain('412');
    expect(text).toContain('25');
    expect(text).toContain('Total plays');
  });

  test('given isLoading > renders skeleton, not cards', () => {
    const r = render(<OverviewCards isLoading />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-overview-skeleton"]'),
    ).toBeTruthy();
    expect(
      r.container.querySelector('[data-testid="reports-overview-cards"]'),
    ).toBeNull();
  });

  test('given totalListeningHours 64.3499 > renders as 64.3 (1 decimal)', () => {
    const r = render(<OverviewCards overview={SAMPLE} />);
    rendered.push(r);
    const hoursCard = r.container.querySelector(
      '[data-testid="reports-overview-listening-hours"]',
    );
    expect(hoursCard).toBeTruthy();
    expect(hoursCard?.textContent ?? '').toContain('64.3');
    // And NOT 64.35 (we want exactly 1 decimal).
    expect(hoursCard?.textContent ?? '').not.toContain('64.35');
  });

  test('given missing overview > falls back to skeleton', () => {
    const r = render(<OverviewCards />);
    rendered.push(r);
    expect(
      r.container.querySelector('[data-testid="reports-overview-skeleton"]'),
    ).toBeTruthy();
  });
});
