import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { minutes?: number; target?: number }) => {
      if (key === 'clocks.preview.title') return 'Live preview';
      if (key === 'clocks.preview.estimated')
        return `~ ${opts?.minutes ?? 0} min of ${opts?.target ?? 0} min target`;
      if (key === 'clocks.preview.overflow')
        return `Over target by ${opts?.minutes ?? 0} min`;
      if (key === 'clocks.preview.underflow')
        return `Under target by ${opts?.minutes ?? 0} min`;
      const palette: Record<string, string> = {
        'clocks.slotPalette.music': 'Music',
        'clocks.slotPalette.sweeper': 'Sweeper',
        'clocks.slotPalette.liner': 'Liner',
        'clocks.slotPalette.vt': 'Voice track',
        'clocks.slotPalette.id': 'Station ID',
        'clocks.slotPalette.news': 'News',
        'clocks.slotPalette.weather': 'Weather',
        'clocks.slotPalette.spot': 'Spot / ad',
        'clocks.slotPalette.bed': 'Bed',
        'clocks.slotPalette.custom': 'Custom',
      };
      return palette[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { ClockLivePreview, summarisePreview } from './ClockLivePreview';
import type { ClockSlot } from '@/lib/clock-queries';

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

function slot(id: string, durationEstimateMs: number, slotType: ClockSlot['slotType'] = 'music'): ClockSlot {
  return {
    id,
    position: 0,
    slotType,
    categoryId: null,
    durationEstimateMs,
    rulesJson: null,
  };
}

const rendered: Rendered[] = [];

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('summarisePreview', () => {
  test('given on-target slots > status is on-target', () => {
    const s = summarisePreview([slot('a', 1_800_000), slot('b', 1_800_000)], 3_600_000);
    expect(s.totalMs).toBe(3_600_000);
    expect(s.totalMinutes).toBe(60);
    expect(s.targetMinutes).toBe(60);
    expect(s.status).toBe('on-target');
  });

  test('given overflow > status is overflow with positive drift', () => {
    const s = summarisePreview([slot('a', 4_200_000)], 3_600_000);
    expect(s.driftMs).toBe(600_000);
    expect(s.status).toBe('overflow');
  });

  test('given underflow > status is underflow with negative drift', () => {
    const s = summarisePreview([slot('a', 1_800_000)], 3_600_000);
    expect(s.driftMs).toBe(-1_800_000);
    expect(s.status).toBe('underflow');
  });

  test('given no slots > total is 0 and status is underflow', () => {
    const s = summarisePreview([], 3_600_000);
    expect(s.totalMs).toBe(0);
    expect(s.status).toBe('underflow');
  });
});

describe('ClockLivePreview', () => {
  test('given slots totalling 60min with target 60min > shows on-target copy', () => {
    const slots = [slot('a', 1_800_000), slot('b', 1_800_000)];
    const r = render(<ClockLivePreview slots={slots} targetDurationMs={3_600_000} />);
    rendered.push(r);
    const status = r.container.querySelector('[data-testid="preview-status"]');
    expect(status?.textContent ?? '').toContain('60 min of 60 min target');
  });

  test('given total over target > shows overflow copy', () => {
    const slots = [slot('a', 4_200_000)]; // 70 min
    const r = render(<ClockLivePreview slots={slots} targetDurationMs={3_600_000} />);
    rendered.push(r);
    const status = r.container.querySelector('[data-testid="preview-status"]');
    expect(status?.textContent ?? '').toContain('Over target by 10 min');
  });

  test('given total under target > shows underflow copy', () => {
    const slots = [slot('a', 1_800_000)]; // 30 min
    const r = render(<ClockLivePreview slots={slots} targetDurationMs={3_600_000} />);
    rendered.push(r);
    const status = r.container.querySelector('[data-testid="preview-status"]');
    expect(status?.textContent ?? '').toContain('Under target by 30 min');
  });

  test('renders one bar segment per slot', () => {
    const slots = [slot('a', 600_000), slot('b', 600_000), slot('c', 600_000)];
    const r = render(<ClockLivePreview slots={slots} targetDurationMs={3_600_000} />);
    rendered.push(r);
    const segs = r.container.querySelectorAll('[data-testid^="preview-segment-"]');
    expect(segs.length).toBe(3);
  });
});
