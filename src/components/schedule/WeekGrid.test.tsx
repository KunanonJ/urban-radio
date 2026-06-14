import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { ScheduleAssignment } from '@/lib/schedule-queries';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'schedule.weekdays.sun': 'Sun',
        'schedule.weekdays.mon': 'Mon',
        'schedule.weekdays.tue': 'Tue',
        'schedule.weekdays.wed': 'Wed',
        'schedule.weekdays.thu': 'Thu',
        'schedule.weekdays.fri': 'Fri',
        'schedule.weekdays.sat': 'Sat',
        'schedule.cell.empty': 'Empty',
        'schedule.cell.click': 'Click to edit',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { WeekGrid } from './WeekGrid';

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

const rendered: Rendered[] = [];

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

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

describe('WeekGrid', () => {
  test('given 7 weekdays × 24 hours > renders 168 cells', () => {
    const r = render(
      <WeekGrid
        assignments={[]}
        clockNamesById={{}}
        onAssign={() => {}}
        onEdit={() => {}}
      />,
    );
    rendered.push(r);

    const cells = r.container.querySelectorAll('[data-grid-cell="true"]');
    expect(cells.length).toBe(7 * 24);
  });

  test('given assignment on Mon 10:00 > renders chip with clock name in that cell', () => {
    const a = makeAssignment({ weekday: 1, hour: 10, clockId: 'c1' });
    const r = render(
      <WeekGrid
        assignments={[a]}
        clockNamesById={{ c1: 'Morning Drive' }}
        onAssign={() => {}}
        onEdit={() => {}}
      />,
    );
    rendered.push(r);

    const target = r.container.querySelector(
      '[data-grid-cell="true"][data-weekday="1"][data-hour="10"]',
    );
    expect(target).not.toBeNull();
    expect((target?.textContent ?? '').includes('Morning Drive')).toBe(true);
  });

  test('given click on empty cell > calls onAssign with (weekday, hour)', () => {
    const onAssign = vi.fn<(weekday: number, hour: number) => void>();
    const r = render(
      <WeekGrid
        assignments={[]}
        clockNamesById={{}}
        onAssign={onAssign}
        onEdit={() => {}}
      />,
    );
    rendered.push(r);

    const cell = r.container.querySelector(
      '[data-grid-cell="true"][data-weekday="3"][data-hour="14"]',
    ) as HTMLButtonElement | null;
    expect(cell).not.toBeNull();

    act(() => {
      cell!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onAssign).toHaveBeenCalledWith(3, 14);
  });

  test('given click on occupied cell > calls onEdit with the assignment', () => {
    const a = makeAssignment({ weekday: 5, hour: 6, clockId: 'c2' });
    const onEdit = vi.fn<(assignment: ScheduleAssignment) => void>();
    const r = render(
      <WeekGrid
        assignments={[a]}
        clockNamesById={{ c2: 'Friday Sweep' }}
        onAssign={() => {}}
        onEdit={onEdit}
      />,
    );
    rendered.push(r);

    const cell = r.container.querySelector(
      '[data-grid-cell="true"][data-weekday="5"][data-hour="6"]',
    ) as HTMLButtonElement | null;
    expect(cell).not.toBeNull();

    act(() => {
      cell!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0].id).toBe(a.id);
  });

  test('given grid > renders 7 weekday column headers', () => {
    const r = render(
      <WeekGrid
        assignments={[]}
        clockNamesById={{}}
        onAssign={() => {}}
        onEdit={() => {}}
      />,
    );
    rendered.push(r);

    const headers = r.container.querySelectorAll('[data-weekday-header="true"]');
    expect(headers.length).toBe(7);
    const headerText = Array.from(headers).map((el) => el.textContent ?? '');
    expect(headerText[0]).toContain('Sun');
    expect(headerText[6]).toContain('Sat');
  });
});
