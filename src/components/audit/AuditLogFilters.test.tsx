import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Radix Select is awkward under jsdom; swap for a native <select> in tests.
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
  function passthrough({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }
  function SelectItem({ value, children }: { value: string; children: ReactNode }) {
    return <option value={value}>{children}</option>;
  }
  return {
    Select,
    SelectTrigger: passthrough,
    SelectContent: passthrough,
    SelectValue: () => null,
    SelectItem,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'auditLog.filter.all': 'All actions',
        'auditLog.filter.actor': 'Actor',
        'auditLog.filter.action': 'Action type',
        'auditLog.filter.target': 'Target type',
        'auditLog.filter.from': 'From',
        'auditLog.filter.to': 'To',
        'auditLog.filter.search': 'Search payload',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { AuditLogFilters } from './AuditLogFilters';
import type { AuditLogFilters as Filters } from '@/lib/audit-log-queries';

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

function typeInto(input: HTMLInputElement, value: string) {
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

describe('AuditLogFilters', () => {
  test('given user picks an action > onFilterChange fires with the action', () => {
    const onChange = vi.fn();
    const r = render(<AuditLogFilters filters={{}} onFilterChange={onChange} />);
    rendered.push(r);

    // First select-mock is the action select.
    const selects = r.container.querySelectorAll('[data-testid="select-mock"]');
    const actionSelect = selects[0] as HTMLSelectElement;
    expect(actionSelect).toBeTruthy();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(actionSelect, 'create');
      actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'create' }));
  });

  test('given user types in search > debounced onFilterChange fires after 300ms', () => {
    const onChange = vi.fn();
    const r = render(<AuditLogFilters filters={{}} onFilterChange={onChange} />);
    rendered.push(r);

    const input = r.container.querySelector('[data-testid="alf-search-input"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    act(() => {
      typeInto(input, 'morning');
    });
    // Before debounce window — no call yet.
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(310);
    });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ search: 'morning' }));
  });

  test('given Clear button click > resets filters and notifies parent with empty object', () => {
    const onChange = vi.fn();
    const initial: Filters = { action: 'update', search: 'foo' };
    const r = render(<AuditLogFilters filters={initial} onFilterChange={onChange} />);
    rendered.push(r);

    const clear = r.container.querySelector('[data-testid="alf-clear"]') as HTMLButtonElement;
    expect(clear).toBeTruthy();
    expect(clear.disabled).toBe(false);
    act(() => {
      clear.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith({});
  });
});
