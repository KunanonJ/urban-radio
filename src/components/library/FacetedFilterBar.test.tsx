import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Radix Select uses pointer-events + portal that's brittle under jsdom. Swap
// it for a plain <select> in tests so we can drive the value via change events.
vi.mock('@/components/ui/select', () => {
  type SelectProps = {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  };
  function Select({ value, onValueChange, children }: SelectProps) {
    return (
      <select
        data-testid="select-mock"
        value={value}
        onChange={(e) => onValueChange(e.currentTarget.value)}
      >
        {children}
      </select>
    );
  }
  // SelectTrigger / SelectContent / SelectValue are no-ops in this mock; we
  // only need <SelectItem> to surface as a native <option>.
  function SelectTrigger({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }
  function SelectContent({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }
  function SelectValue() {
    return null;
  }
  function SelectItem({ value, children }: { value: string; children: ReactNode }) {
    return <option value={value}>{children}</option>;
  }
  return { Select, SelectTrigger, SelectContent, SelectValue, SelectItem };
});

import { FacetedFilterBar } from './FacetedFilterBar';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function renderBar(element: ReactNode): Rendered {
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

function typeInto(input: HTMLInputElement, value: string) {
  // React listens via the prototype `value` setter; we have to go through it
  // for the synthetic change event to fire.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const rendered: Rendered[] = [];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
  vi.useRealTimers();
});

describe('FacetedFilterBar', () => {
  test('given typed query > emits onFilterChange with debounced search after 300ms', () => {
    const onChange = vi.fn();
    const r = renderBar(<FacetedFilterBar filters={{}} onFilterChange={onChange} />);
    rendered.push(r);

    const input = r.container.querySelector('[data-testid="ffb-search-input"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    act(() => {
      if (input) typeInto(input, 'kick');
    });

    // Synchronously, no change should have fired yet (debounced).
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(310);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ search: 'kick' });
  });

  test('given category selected > emits onFilterChange with category id', () => {
    const onChange = vi.fn();
    const r = renderBar(
      <FacetedFilterBar
        filters={{}}
        onFilterChange={onChange}
        categories={[
          { id: 'cat-rock', label: 'Rock' },
          { id: 'cat-jazz', label: 'Jazz' },
        ]}
      />,
    );
    rendered.push(r);

    const selects = r.container.querySelectorAll('[data-testid="select-mock"]');
    // selects[0] = category, selects[1] = file type.
    const categorySelect = selects[0] as HTMLSelectElement | undefined;
    expect(categorySelect).toBeDefined();

    act(() => {
      if (categorySelect) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(categorySelect, 'cat-jazz');
        categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ category: 'cat-jazz' });
  });

  test('given BPM range typed > emits onFilterChange with min/max', () => {
    const onChange = vi.fn();
    const r = renderBar(<FacetedFilterBar filters={{}} onFilterChange={onChange} />);
    rendered.push(r);

    const minInput = r.container.querySelector('[data-testid="ffb-bpm-min"]') as HTMLInputElement | null;
    expect(minInput).not.toBeNull();

    act(() => {
      if (minInput) typeInto(minInput, '90');
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ minBpm: 90 });
  });

  test('given clear button > resets all filters', () => {
    const onChange = vi.fn();
    const r = renderBar(
      <FacetedFilterBar
        filters={{ search: 'kick', category: 'cat-rock', minBpm: 90 }}
        onFilterChange={onChange}
      />,
    );
    rendered.push(r);

    const clear = r.container.querySelector('[data-testid="ffb-clear"]') as HTMLButtonElement | null;
    expect(clear).not.toBeNull();
    expect(clear?.disabled).toBe(false);

    act(() => {
      clear?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({});
  });

  test('given no active filters > clear button disabled', () => {
    const onChange = vi.fn();
    const r = renderBar(<FacetedFilterBar filters={{}} onFilterChange={onChange} />);
    rendered.push(r);
    const clear = r.container.querySelector('[data-testid="ffb-clear"]') as HTMLButtonElement | null;
    expect(clear).not.toBeNull();
    expect(clear?.disabled).toBe(true);
  });
});
