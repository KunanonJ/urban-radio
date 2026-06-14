import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { ScheduleAssignment } from '@/lib/schedule-queries';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'schedule.conflict.title': 'Overlap detected',
        'schedule.conflict.description':
          'A clock is already scheduled for this slot. Choose how to resolve it.',
        'schedule.conflict.override': 'Override',
        'schedule.conflict.merge': 'Keep both',
        'schedule.conflict.cancel': 'Cancel',
        'schedule.weekdays.sun': 'Sun',
        'schedule.weekdays.mon': 'Mon',
        'schedule.weekdays.tue': 'Tue',
        'schedule.weekdays.wed': 'Wed',
        'schedule.weekdays.thu': 'Thu',
        'schedule.weekdays.fri': 'Fri',
        'schedule.weekdays.sat': 'Sat',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { ConflictResolutionDialog } from './ConflictResolutionDialog';

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
  // Radix renders Dialog content in a portal. Clear stray nodes between tests.
  document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((el) => el.remove());
}

const rendered: Rendered[] = [];

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

function findButtonByText(text: string): HTMLButtonElement | null {
  const all = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
  return all.find((b) => (b.textContent ?? '').trim() === text) ?? null;
}

function findInDialogByText(text: string): Element | null {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  for (const d of Array.from(dialogs)) {
    if ((d.textContent ?? '').includes(text)) return d;
  }
  return null;
}

function makeAssignment(overrides: Partial<ScheduleAssignment> = {}): ScheduleAssignment {
  return {
    id: 'a-' + Math.random().toString(36).slice(2, 8),
    stationId: 's1',
    clockId: 'c1',
    weekday: 1,
    hour: 10,
    validFrom: null,
    validUntil: null,
    rrule: null,
    ...overrides,
  };
}

describe('ConflictResolutionDialog', () => {
  test('given 2 conflicts > lists both', () => {
    const a1 = makeAssignment({ weekday: 1, hour: 10, clockId: 'c1' });
    const a2 = makeAssignment({ weekday: 1, hour: 10, clockId: 'c2' });
    const r = render(
      <ConflictResolutionDialog
        open
        conflicts={[a1, a2]}
        clockNamesById={{ c1: 'Morning Drive', c2: 'Sweep' }}
        onOverride={() => {}}
        onCancel={() => {}}
      />,
    );
    rendered.push(r);

    expect(findInDialogByText('Morning Drive')).not.toBeNull();
    expect(findInDialogByText('Sweep')).not.toBeNull();
  });

  test('given Override click > calls onOverride', () => {
    const onOverride = vi.fn();
    const a1 = makeAssignment({ weekday: 0, hour: 0, clockId: 'c1' });
    const r = render(
      <ConflictResolutionDialog
        open
        conflicts={[a1]}
        clockNamesById={{ c1: 'A' }}
        onOverride={onOverride}
        onCancel={() => {}}
      />,
    );
    rendered.push(r);

    const btn = findButtonByText('Override');
    expect(btn).not.toBeNull();
    act(() => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onOverride).toHaveBeenCalledTimes(1);
  });

  test('Keep both button is disabled with tooltip-hint attribute', () => {
    const a1 = makeAssignment({ weekday: 0, hour: 0, clockId: 'c1' });
    const r = render(
      <ConflictResolutionDialog
        open
        conflicts={[a1]}
        clockNamesById={{ c1: 'A' }}
        onOverride={() => {}}
        onCancel={() => {}}
      />,
    );
    rendered.push(r);

    const btn = findButtonByText('Keep both');
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(true);
    // We mark this button so consumers know it's intentional ("Coming soon").
    expect(btn!.getAttribute('data-merge-disabled')).toBe('true');
  });

  test('given Cancel click > calls onCancel', () => {
    const onCancel = vi.fn();
    const a1 = makeAssignment({ weekday: 0, hour: 0, clockId: 'c1' });
    const r = render(
      <ConflictResolutionDialog
        open
        conflicts={[a1]}
        clockNamesById={{ c1: 'A' }}
        onOverride={() => {}}
        onCancel={onCancel}
      />,
    );
    rendered.push(r);

    const btn = findButtonByText('Cancel');
    expect(btn).not.toBeNull();
    act(() => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
