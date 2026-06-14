import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DndContext } from '@dnd-kit/core';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'clocks.slotPalette.title': 'Slot types',
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

import { ClockSlotPalette } from './ClockSlotPalette';
import { CLOCK_SLOT_TYPES } from '@/lib/clock-queries';

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
    // `useDraggable` requires a DndContext ancestor.
    root.render(<DndContext>{element}</DndContext>);
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

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('ClockSlotPalette', () => {
  test('renders all 10 slot types', () => {
    const r = render(<ClockSlotPalette />);
    rendered.push(r);
    for (const type of CLOCK_SLOT_TYPES) {
      const chip = r.container.querySelector(`[data-testid="palette-chip-${type}"]`);
      expect(chip).toBeTruthy();
      expect(chip?.getAttribute('data-slot-type')).toBe(type);
    }
    // Exactly 10 — guard against accidental duplication.
    expect(r.container.querySelectorAll('[data-testid^="palette-chip-"]').length).toBe(10);
  });

  test('renders translated palette title', () => {
    const r = render(<ClockSlotPalette />);
    rendered.push(r);
    expect((r.container.textContent ?? '').includes('Slot types')).toBe(true);
  });

  test('given chip click > onAddSlot called with slotType', () => {
    const onAddSlot = vi.fn();
    const r = render(<ClockSlotPalette onAddSlot={onAddSlot} />);
    rendered.push(r);
    const musicChip = r.container.querySelector(
      '[data-testid="palette-chip-music"]',
    ) as HTMLButtonElement | null;
    expect(musicChip).toBeTruthy();
    act(() => {
      musicChip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onAddSlot).toHaveBeenCalledWith('music');
  });
});
