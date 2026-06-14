import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommandPalette } from '@/components/CommandPalette';

// cmdk requires ResizeObserver and Element.scrollIntoView; jsdom provides neither.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserverStub }).ResizeObserver ??= ResizeObserverStub;
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'commandPalette.title': 'Command palette',
        'commandPalette.placeholder': 'Type a command or search…',
        'commandPalette.noResults': 'No matching commands',
        'commandPalette.go.library': 'Go to Library',
        'commandPalette.go.queue': 'Go to Queue',
        'commandPalette.go.search': 'Go to Search',
        'commandPalette.go.nowPlaying': 'Go to Now Playing',
        'commandPalette.go.cart': 'Go to Cart Wall',
        'commandPalette.go.broadcast': 'Go to Broadcast',
        'commandPalette.go.spotSchedule': 'Go to Spot Schedule',
        'commandPalette.go.settings': 'Go to Settings',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RenderResult = { container: HTMLDivElement; root: Root };

function renderPalette(): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<CommandPalette />);
  });

  return { container, root };
}

function cleanup({ container, root }: RenderResult) {
  act(() => {
    root.unmount();
  });
  if (container.parentNode) {
    container.parentNode.removeChild(container);
  }
}

function pressKey(opts: KeyboardEventInit & { key: string }) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...opts }));
  });
}

function getItemByText(text: string): HTMLElement | null {
  const items = Array.from(document.querySelectorAll('[cmdk-item]')) as HTMLElement[];
  return items.find((el) => (el.textContent ?? '').includes(text)) ?? null;
}

function isPaletteOpen(): boolean {
  // The palette renders cmdk's [cmdk-root] inside a portal; presence of input proves it's open.
  return document.querySelector('[cmdk-input]') !== null;
}

beforeEach(() => {
  pushMock.mockReset();
});

afterEach(() => {
  // Ensure modal is closed between tests by clearing any portal-rendered content.
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
});

describe('CommandPalette', () => {
  test('given Cmd+K pressed > opens', () => {
    const result = renderPalette();

    expect(isPaletteOpen()).toBe(false);

    pressKey({ key: 'k', metaKey: true });

    expect(isPaletteOpen()).toBe(true);

    cleanup(result);
  });

  test('given Ctrl+K pressed > opens', () => {
    const result = renderPalette();

    pressKey({ key: 'k', ctrlKey: true });

    expect(isPaletteOpen()).toBe(true);

    cleanup(result);
  });

  test('given Escape pressed when open > closes', () => {
    const result = renderPalette();

    pressKey({ key: 'k', metaKey: true });
    expect(isPaletteOpen()).toBe(true);

    pressKey({ key: 'Escape' });
    expect(isPaletteOpen()).toBe(false);

    cleanup(result);
  });

  test('given action clicked > calls router.push with expected path', () => {
    const result = renderPalette();

    pressKey({ key: 'k', metaKey: true });
    expect(isPaletteOpen()).toBe(true);

    const queueItem = getItemByText('Go to Queue');
    expect(queueItem).not.toBeNull();

    act(() => {
      queueItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(pushMock).toHaveBeenCalledWith('/app/queue');
    expect(isPaletteOpen()).toBe(false);

    cleanup(result);
  });

  test('given typed search > filters visible actions', () => {
    const result = renderPalette();

    pressKey({ key: 'k', metaKey: true });

    const input = document.querySelector('[cmdk-input]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    act(() => {
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, 'queue');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // cmdk filters synchronously after input event; non-matching items get the `hidden` attribute.
    const allItems = Array.from(document.querySelectorAll('[cmdk-item]')) as HTMLElement[];
    const visibleLabels = allItems
      .filter((el) => !el.hasAttribute('hidden'))
      .map((el) => el.textContent ?? '');

    // "Go to Queue" matches "queue".
    expect(visibleLabels.some((label) => label.includes('Go to Queue'))).toBe(true);
    // "Go to Library" does NOT contain "queue".
    expect(visibleLabels.some((label) => label.includes('Go to Library'))).toBe(false);

    cleanup(result);
  });
});
