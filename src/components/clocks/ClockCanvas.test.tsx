import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'clocks.canvasEmpty': 'Drag a slot from the left to start building this hour.',
        'clocks.slot.category': 'Category',
        'clocks.slot.duration': 'Duration (s)',
        'clocks.slot.remove': 'Remove slot',
        'clocks.slot.noCategory': '(no category)',
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
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { ClockCanvas, reorderSlots, type ClockCanvasSlot } from './ClockCanvas';

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

function makeSlot(id: string, position: number, overrides: Partial<ClockCanvasSlot> = {}): ClockCanvasSlot {
  return {
    id,
    position,
    slotType: overrides.slotType ?? 'music',
    categoryId: overrides.categoryId ?? null,
    durationEstimateMs: overrides.durationEstimateMs ?? 180_000,
    rulesJson: overrides.rulesJson ?? null,
    ...overrides,
  };
}

const rendered: Rendered[] = [];

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('ClockCanvas', () => {
  test('given 3 slots > renders them in position order', () => {
    const slots = [
      makeSlot('a', 0, { slotType: 'music' }),
      makeSlot('b', 1, { slotType: 'sweeper' }),
      makeSlot('c', 2, { slotType: 'liner' }),
    ];
    const r = render(<ClockCanvas slots={slots} />);
    rendered.push(r);
    const rows = Array.from(r.container.querySelectorAll<HTMLElement>('[data-slot-id]'));
    expect(rows.map((el) => el.getAttribute('data-slot-id'))).toEqual(['a', 'b', 'c']);
  });

  test('given empty slots > shows canvasEmpty hint', () => {
    const r = render(<ClockCanvas slots={[]} />);
    rendered.push(r);
    const empty = r.container.querySelector('[data-testid="canvas-empty"]');
    expect(empty).toBeTruthy();
    expect((empty?.textContent ?? '').includes('Drag a slot from the left')).toBe(true);
  });

  test('given slot remove click > calls onRemove with slot id', () => {
    const onRemove = vi.fn();
    const slots = [makeSlot('s1', 0)];
    const r = render(<ClockCanvas slots={slots} onRemove={onRemove} />);
    rendered.push(r);
    const btn = r.container.querySelector(
      '[data-testid="canvas-remove-s1"]',
    ) as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    act(() => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onRemove).toHaveBeenCalledWith('s1');
  });

  test('given duration field change > calls onUpdateSlot with ms', () => {
    const onUpdateSlot = vi.fn();
    const slots = [makeSlot('s1', 0, { durationEstimateMs: 60_000 })];
    const r = render(<ClockCanvas slots={slots} onUpdateSlot={onUpdateSlot} />);
    rendered.push(r);
    const input = r.container.querySelector(
      '[data-testid="canvas-slot-s1-duration"]',
    ) as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input?.value).toBe('60');
    // React 18 onChange relies on a synthetic event. Use the prototype
    // setter so React picks up the value change.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    act(() => {
      setter?.call(input!, '120');
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onUpdateSlot).toHaveBeenCalledWith('s1', { durationEstimateMs: 120_000 });
  });

  test('reorderSlots > moves item and renumbers positions', () => {
    const slots = [
      makeSlot('a', 0),
      makeSlot('b', 1),
      makeSlot('c', 2),
    ];
    // Move 'a' to where 'c' is.
    const next = reorderSlots(slots, 'a', 'c');
    expect(next.map((s) => s.id)).toEqual(['b', 'c', 'a']);
    expect(next.map((s) => s.position)).toEqual([0, 1, 2]);
  });

  test('reorderSlots > unknown id is a no-op', () => {
    const slots = [makeSlot('a', 0), makeSlot('b', 1)];
    expect(reorderSlots(slots, 'x', 'b')).toBe(slots);
    expect(reorderSlots(slots, 'a', 'a')).toBe(slots);
  });
});
