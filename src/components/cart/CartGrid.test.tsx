import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CartGrid } from '@/components/cart/CartGrid';
import type { CartTab } from '@/lib/cart-store';
import { mockTracks } from '@/lib/mock-data';

vi.mock('next/image', () => ({
  default: ({ alt, src, width, height, className }: ComponentProps<'img'> & { width?: number; height?: number }) =>
    React.createElement('img', { alt, src: src as string, width, height, className }),
}));

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeTab(overrides: Partial<CartTab> = {}): CartTab {
  const gridCols = overrides.gridCols ?? 4;
  const gridRows = overrides.gridRows ?? 4;
  const total = gridCols * gridRows;
  return {
    id: overrides.id ?? 'tab-1',
    name: overrides.name ?? 'Main',
    gridCols,
    gridRows,
    slots: overrides.slots ?? Array.from({ length: total }, () => null),
    hotkeyMap: overrides.hotkeyMap,
  };
}

function renderNode(node: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

function cleanup(container: HTMLDivElement, root: Root) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe('CartGrid', () => {
  test('given 4x4 tab > renders 16 tiles', () => {
    const tab = makeTab({ gridCols: 4, gridRows: 4 });
    const { container, root } = renderNode(<CartGrid tab={tab} />);
    const tiles = container.querySelectorAll('[data-testid^="cart-tile-"][data-slot-index]');
    expect(tiles).toHaveLength(16);
    cleanup(container, root);
  });

  test('given 8x4 tab > grid-template-columns has 8 columns', () => {
    const tab = makeTab({ gridCols: 8, gridRows: 4 });
    const { container, root } = renderNode(<CartGrid tab={tab} />);
    const grid = container.querySelector('[data-testid="cart-grid"]') as HTMLElement | null;
    expect(grid?.getAttribute('data-cols')).toBe('8');
    expect(grid?.style.gridTemplateColumns).toContain('repeat(8');
    cleanup(container, root);
  });

  test('given onSlotClick > called with slot index on tile click', () => {
    const tab = makeTab({
      gridCols: 4,
      gridRows: 4,
      slots: Array.from({ length: 16 }, (_, i) => (i === 0 ? mockTracks[0] : null)),
    });
    const onSlotClick = vi.fn();
    const { container, root } = renderNode(<CartGrid tab={tab} onSlotClick={onSlotClick} />);
    const tile = container.querySelector('[data-testid="cart-tile-0"]') as HTMLButtonElement | null;
    act(() => {
      tile?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSlotClick).toHaveBeenCalledWith(0);
    cleanup(container, root);
  });

  test('given default hotkeys > slot 0 hotkey label is A', () => {
    const tab = makeTab({ gridCols: 4, gridRows: 4 });
    const { container, root } = renderNode(<CartGrid tab={tab} />);
    const hotkey = container.querySelector('[data-testid="cart-tile-0-hotkey"]');
    expect(hotkey?.textContent).toBe('A');
    cleanup(container, root);
  });
});
