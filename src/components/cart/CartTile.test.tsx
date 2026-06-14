import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CartTile } from '@/components/cart/CartTile';
import { mockTracks } from '@/lib/mock-data';

vi.mock('next/image', () => ({
  default: ({ alt, src, width, height, className }: ComponentProps<'img'> & { width?: number; height?: number }) =>
    React.createElement('img', { alt, src: src as string, width, height, className }),
}));

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe('CartTile', () => {
  test('given track > shows title', () => {
    const { container, root } = renderNode(
      <CartTile slotIndex={0} track={mockTracks[0]} hotkey="A" onClick={() => {}} />,
    );
    const title = container.querySelector('[data-testid="cart-tile-0-title"]');
    expect(title?.textContent).toContain(mockTracks[0].title);
    cleanup(container, root);
  });

  test('given hotkey > shows the key letter', () => {
    const { container, root } = renderNode(
      <CartTile slotIndex={0} track={mockTracks[0]} hotkey="A" onClick={() => {}} />,
    );
    const hotkey = container.querySelector('[data-testid="cart-tile-0-hotkey"]');
    expect(hotkey?.textContent).toBe('A');
    cleanup(container, root);
  });

  test('given state=playing > has data-state="playing"', () => {
    const { container, root } = renderNode(
      <CartTile slotIndex={0} track={mockTracks[0]} hotkey="A" state="playing" />,
    );
    const tile = container.querySelector('[data-testid="cart-tile-0"]');
    expect(tile?.getAttribute('data-state')).toBe('playing');
    cleanup(container, root);
  });

  test('given state=armed > has data-state="armed"', () => {
    const { container, root } = renderNode(
      <CartTile slotIndex={1} track={mockTracks[0]} hotkey="B" state="armed" />,
    );
    const tile = container.querySelector('[data-testid="cart-tile-1"]');
    expect(tile?.getAttribute('data-state')).toBe('armed');
    cleanup(container, root);
  });

  test('given click > calls onClick', () => {
    const onClick = vi.fn();
    const { container, root } = renderNode(
      <CartTile slotIndex={0} track={mockTracks[0]} hotkey="A" onClick={onClick} />,
    );
    const tile = container.querySelector('[data-testid="cart-tile-0"]') as HTMLButtonElement | null;
    act(() => {
      tile?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    cleanup(container, root);
  });

  test('given empty slot > shows placeholder', () => {
    const { container, root } = renderNode(
      <CartTile slotIndex={3} track={null} hotkey="D" />,
    );
    const empty = container.querySelector('[data-testid="cart-tile-3-empty"]');
    expect(empty).not.toBeNull();
    cleanup(container, root);
  });

  test('given no hotkey > falls back to slot index label', () => {
    const { container, root } = renderNode(
      <CartTile slotIndex={47} track={null} hotkey={null} />,
    );
    const hotkey = container.querySelector('[data-testid="cart-tile-47-hotkey"]');
    expect(hotkey?.textContent).toBe('#48');
    cleanup(container, root);
  });
});
