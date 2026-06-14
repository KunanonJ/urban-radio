import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CartTabBar } from '@/components/cart/CartTabBar';
import type { CartTab } from '@/lib/cart-store';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeTab(id: string, name: string): CartTab {
  return { id, name, gridCols: 4, gridRows: 4, slots: Array.from({ length: 16 }, () => null) };
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

describe('CartTabBar', () => {
  test('given 3 tabs > renders 3 tab buttons', () => {
    const tabs = [makeTab('a', 'Main'), makeTab('b', 'Sweepers'), makeTab('c', 'IDs')];
    const { container, root } = renderNode(
      <CartTabBar
        tabs={tabs}
        activeTabId="a"
        onSelect={() => {}}
        onCreate={() => {}}
        onRename={() => {}}
        onRemove={() => {}}
      />,
    );
    const buttons = container.querySelectorAll('[data-testid^="cart-tab-button-"]');
    expect(buttons).toHaveLength(3);
    cleanup(container, root);
  });

  test('given + click > opens new-tab input', () => {
    const tabs = [makeTab('a', 'Main')];
    const { container, root } = renderNode(
      <CartTabBar
        tabs={tabs}
        activeTabId="a"
        onSelect={() => {}}
        onCreate={() => {}}
        onRename={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(container.querySelector('[data-testid="cart-tab-create-input"]')).toBeNull();
    const addBtn = container.querySelector('[data-testid="cart-tab-add-button"]') as HTMLButtonElement | null;
    act(() => {
      addBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const input = container.querySelector('[data-testid="cart-tab-create-input"]');
    expect(input).not.toBeNull();
    cleanup(container, root);
  });

  test('given form submit > calls onCreate with trimmed name', () => {
    const tabs = [makeTab('a', 'Main')];
    const onCreate = vi.fn();
    const { container, root } = renderNode(
      <CartTabBar
        tabs={tabs}
        activeTabId="a"
        onSelect={() => {}}
        onCreate={onCreate}
        onRename={() => {}}
        onRemove={() => {}}
      />,
    );
    const addBtn = container.querySelector('[data-testid="cart-tab-add-button"]') as HTMLButtonElement | null;
    act(() => {
      addBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const input = container.querySelector('[data-testid="cart-tab-create-input"]') as HTMLInputElement | null;
    act(() => {
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, '  Sweepers  ');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    const form = container.querySelector('[data-testid="cart-tab-create-form"]') as HTMLFormElement | null;
    act(() => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onCreate).toHaveBeenCalledWith('Sweepers');
    cleanup(container, root);
  });

  test('given double-click on tab > enters rename mode', () => {
    const tabs = [makeTab('a', 'Main'), makeTab('b', 'Sweepers')];
    const { container, root } = renderNode(
      <CartTabBar
        tabs={tabs}
        activeTabId="a"
        onSelect={() => {}}
        onCreate={() => {}}
        onRename={() => {}}
        onRemove={() => {}}
      />,
    );
    const tabBtn = container.querySelector('[data-testid="cart-tab-button-b"]') as HTMLButtonElement | null;
    act(() => {
      tabBtn?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const input = container.querySelector('[data-testid="cart-tab-rename-input"]');
    expect(input).not.toBeNull();
    cleanup(container, root);
  });

  test('given click on inactive tab > calls onSelect with id', () => {
    const tabs = [makeTab('a', 'Main'), makeTab('b', 'Sweepers')];
    const onSelect = vi.fn();
    const { container, root } = renderNode(
      <CartTabBar
        tabs={tabs}
        activeTabId="a"
        onSelect={onSelect}
        onCreate={() => {}}
        onRename={() => {}}
        onRemove={() => {}}
      />,
    );
    const tabBtn = container.querySelector('[data-testid="cart-tab-button-b"]') as HTMLButtonElement | null;
    act(() => {
      tabBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('b');
    cleanup(container, root);
  });

  test('given only one tab > remove button is not rendered', () => {
    const tabs = [makeTab('a', 'Main')];
    const { container, root } = renderNode(
      <CartTabBar
        tabs={tabs}
        activeTabId="a"
        onSelect={() => {}}
        onCreate={() => {}}
        onRename={() => {}}
        onRemove={() => {}}
      />,
    );
    const remove = container.querySelector('[aria-label^="Remove "]');
    expect(remove).toBeNull();
    cleanup(container, root);
  });
});
