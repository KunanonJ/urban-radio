import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'reports.range.label': 'Date range',
        'reports.range.last7': 'Last 7',
        'reports.range.last30': 'Last 30',
        'reports.range.last90': 'Last 90',
        'reports.range.thisMonth': 'This month',
        'reports.range.lastMonth': 'Last month',
        'reports.range.custom': 'Custom',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import {
  DateRangePicker,
  computePresetRange,
  type DateRangeValue,
  type RangePreset,
} from './DateRangePicker';

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

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const rendered: Rendered[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  // Freeze "now" to a stable date so computePresetRange is deterministic.
  vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('computePresetRange', () => {
  test('last7 > spans 7 days ending today', () => {
    const r = computePresetRange('last7', new Date('2026-05-15T12:00:00.000Z'));
    expect(r.from.slice(0, 10)).toBe('2026-05-09');
    expect(r.to.slice(0, 10)).toBe('2026-05-15');
  });

  test('last30 > spans 30 days', () => {
    const r = computePresetRange(
      'last30',
      new Date('2026-05-15T12:00:00.000Z'),
    );
    expect(r.from.slice(0, 10)).toBe('2026-04-16');
    expect(r.to.slice(0, 10)).toBe('2026-05-15');
  });

  test('thisMonth > starts on first of month', () => {
    const r = computePresetRange(
      'thisMonth',
      new Date('2026-05-15T12:00:00.000Z'),
    );
    expect(r.from.slice(0, 10)).toBe('2026-05-01');
    expect(r.to.slice(0, 10)).toBe('2026-05-15');
  });

  test('lastMonth > spans previous calendar month', () => {
    const r = computePresetRange(
      'lastMonth',
      new Date('2026-05-15T12:00:00.000Z'),
    );
    expect(r.from.slice(0, 10)).toBe('2026-04-01');
    expect(r.to.slice(0, 10)).toBe('2026-04-30');
  });
});

describe('DateRangePicker', () => {
  test('fires onRangeChange on mount with default preset (last30)', () => {
    const spy = vi.fn();
    const r = render(<DateRangePicker onRangeChange={spy} />);
    rendered.push(r);
    expect(spy).toHaveBeenCalledTimes(1);
    const [range, preset] = spy.mock.calls[0] as [DateRangeValue, RangePreset];
    expect(preset).toBe('last30');
    expect(range.from.slice(0, 10)).toBe('2026-04-16');
    expect(range.to.slice(0, 10)).toBe('2026-05-15');
  });

  test('preset click > emits correct ISO range', () => {
    const spy = vi.fn();
    const r = render(<DateRangePicker onRangeChange={spy} />);
    rendered.push(r);
    spy.mockClear();
    const btn = r.container.querySelector(
      '[data-testid="reports-range-preset-last7"]',
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [range, preset] = spy.mock.calls[0] as [DateRangeValue, RangePreset];
    expect(preset).toBe('last7');
    expect(range.from.slice(0, 10)).toBe('2026-05-09');
  });

  test('custom button > reveals from/to date inputs', () => {
    const spy = vi.fn();
    const r = render(<DateRangePicker onRangeChange={spy} />);
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="reports-range-from"]')).toBeNull();
    act(() => {
      (r.container.querySelector(
        '[data-testid="reports-range-preset-custom"]',
      ) as HTMLButtonElement)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(
      r.container.querySelector('[data-testid="reports-range-from"]'),
    ).toBeTruthy();
    expect(
      r.container.querySelector('[data-testid="reports-range-to"]'),
    ).toBeTruthy();
  });

  test('custom date inputs > emit onRangeChange with ISO strings', () => {
    const spy = vi.fn();
    const r = render(<DateRangePicker onRangeChange={spy} />);
    rendered.push(r);
    // Switch to custom.
    act(() => {
      (r.container.querySelector(
        '[data-testid="reports-range-preset-custom"]',
      ) as HTMLButtonElement)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    spy.mockClear();
    const fromInput = r.container.querySelector(
      '[data-testid="reports-range-from"]',
    ) as HTMLInputElement;
    const toInput = r.container.querySelector(
      '[data-testid="reports-range-to"]',
    ) as HTMLInputElement;
    expect(fromInput).toBeTruthy();
    expect(toInput).toBeTruthy();
    act(() => setInputValue(fromInput, '2026-05-01'));
    // From-only doesn't emit (to empty), so set both:
    act(() => setInputValue(toInput, '2026-05-10'));

    expect(spy).toHaveBeenCalled();
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1] as [
      DateRangeValue,
      RangePreset,
    ];
    expect(lastCall[1]).toBe('custom');
    expect(lastCall[0].from.slice(0, 10)).toBe('2026-05-01');
    expect(lastCall[0].to.slice(0, 10)).toBe('2026-05-10');
  });

  test('custom inputs with from > to > clamps via swap', () => {
    const spy = vi.fn();
    const r = render(<DateRangePicker onRangeChange={spy} />);
    rendered.push(r);
    act(() => {
      (r.container.querySelector(
        '[data-testid="reports-range-preset-custom"]',
      ) as HTMLButtonElement)?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    spy.mockClear();
    const fromInput = r.container.querySelector(
      '[data-testid="reports-range-from"]',
    ) as HTMLInputElement;
    const toInput = r.container.querySelector(
      '[data-testid="reports-range-to"]',
    ) as HTMLInputElement;
    act(() => setInputValue(toInput, '2026-05-01'));
    act(() => setInputValue(fromInput, '2026-05-10'));
    const last = spy.mock.calls[spy.mock.calls.length - 1] as [
      DateRangeValue,
      RangePreset,
    ];
    // After swap: from should be the smaller date.
    expect(last[0].from.slice(0, 10) <= last[0].to.slice(0, 10)).toBe(true);
  });
});
