import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ConflictError, type ScheduleAssignment } from '@/lib/schedule-queries';
import type { ClockRow } from '@/lib/clock-queries';

// ── Shared mock state ────────────────────────────────────────────────────────
let stubAssignments: ScheduleAssignment[] = [];
let stubClocks: ClockRow[] = [];
const mockCreateMutateAsync = vi.fn<(input: unknown) => Promise<{ assignment: ScheduleAssignment }>>();
const mockUpdateMutateAsync = vi.fn<(input: unknown) => Promise<{ assignment: ScheduleAssignment }>>();

vi.mock('@/lib/schedule-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/schedule-queries')>(
    '@/lib/schedule-queries',
  );
  return {
    ...actual,
    useScheduleAssignments: () => ({ data: { assignments: stubAssignments } }),
    useCreateAssignment: () => ({
      mutateAsync: mockCreateMutateAsync,
      isPending: false,
    }),
    useUpdateAssignment: () => ({
      mutateAsync: mockUpdateMutateAsync,
      isPending: false,
    }),
    useDeleteAssignment: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
  };
});

vi.mock('@/lib/clock-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/clock-queries')>(
    '@/lib/clock-queries',
  );
  return {
    ...actual,
    useClocks: () => ({ data: { clocks: stubClocks } }),
  };
});

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'schedule.title': 'Schedule',
        'schedule.subtitle':
          'Drop hour clocks on the weekly grid. Conflicts surface a resolution dialog.',
        'schedule.emptyState.title': 'No schedule assignments',
        'schedule.emptyState.description':
          'Drop an hour clock onto a weekday/hour cell to schedule it.',
        'schedule.emptyState.action': 'Browse clocks',
        'schedule.selectClock': 'Choose a clock to assign',
        'schedule.noClocksHint': 'Create an hour clock first.',
        'schedule.createClock': 'Go to clocks',
        'schedule.weekdays.sun': 'Sun',
        'schedule.weekdays.mon': 'Mon',
        'schedule.weekdays.tue': 'Tue',
        'schedule.weekdays.wed': 'Wed',
        'schedule.weekdays.thu': 'Thu',
        'schedule.weekdays.fri': 'Fri',
        'schedule.weekdays.sat': 'Sat',
        'schedule.cell.empty': 'Empty',
        'schedule.cell.click': 'Click to edit',
        'schedule.conflict.title': 'Overlap detected',
        'schedule.conflict.description':
          'A clock is already scheduled for this slot. Choose how to resolve it.',
        'schedule.conflict.override': 'Override',
        'schedule.conflict.merge': 'Keep both',
        'schedule.conflict.cancel': 'Cancel',
        'schedule.actions.delete': 'Delete assignment',
        'schedule.validRange.from': 'Valid from',
        'schedule.validRange.until': 'Valid until',
        'clocks.save': 'Save',
        'settings.actions.cancel': 'Cancel',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { SchedulePage } from './SchedulePage';

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
  document.querySelectorAll('[role="dialog"], [role="alertdialog"]').forEach((el) => el.remove());
}

function makeClock(id: string, name: string): ClockRow {
  return {
    id,
    name,
    color: '#3b82f6',
    targetDurationMs: 3_600_000,
    createdAt: '2024-01-01T00:00:00Z',
  };
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

const rendered: Rendered[] = [];

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
  stubAssignments = [];
  stubClocks = [];
  mockCreateMutateAsync.mockReset();
  mockUpdateMutateAsync.mockReset();
  pushMock.mockReset();
});

describe('SchedulePage', () => {
  test('given no assignments and at least one clock > renders empty week grid', () => {
    stubAssignments = [];
    stubClocks = [makeClock('c1', 'Morning')];

    const r = render(<SchedulePage />);
    rendered.push(r);

    // The grid renders 168 cells even with no assignments.
    const cells = r.container.querySelectorAll('[data-grid-cell="true"]');
    expect(cells.length).toBe(7 * 24);
    expect(r.container.querySelectorAll('[data-cell-chip="true"]').length).toBe(0);
  });

  test('given no clocks AND no assignments > renders EmptyState', () => {
    stubAssignments = [];
    stubClocks = [];

    const r = render(<SchedulePage />);
    rendered.push(r);

    expect(r.container.textContent ?? '').toContain('No schedule assignments');
  });

  test('given click empty cell > opens assign dialog with that cell pre-filled', () => {
    stubAssignments = [];
    stubClocks = [makeClock('c1', 'Morning')];

    const r = render(<SchedulePage />);
    rendered.push(r);

    const cell = r.container.querySelector(
      '[data-grid-cell="true"][data-weekday="2"][data-hour="11"]',
    ) as HTMLButtonElement | null;
    expect(cell).not.toBeNull();

    act(() => {
      cell!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Dialog shows the formatted weekday/hour as its title — "Tue · 11:00".
    expect(findInDialogByText('Tue')).not.toBeNull();
    expect(findInDialogByText('11:00')).not.toBeNull();
  });

  test('given conflict on submit > opens conflict dialog and Override re-submits with force=true', async () => {
    stubAssignments = [];
    stubClocks = [makeClock('c1', 'Morning')];

    const conflicts = [makeAssignment({ id: 'existing', clockId: 'c1', weekday: 1, hour: 10 })];
    // First call raises ConflictError; second (after Override) resolves successfully.
    mockCreateMutateAsync.mockImplementationOnce(async () => {
      throw new ConflictError(conflicts);
    });
    mockCreateMutateAsync.mockImplementationOnce(async () => ({
      assignment: makeAssignment({ clockId: 'c1', weekday: 1, hour: 10 }),
    }));

    const r = render(<SchedulePage />);
    rendered.push(r);

    // Open the assign dialog at Mon 10:00.
    const cell = r.container.querySelector(
      '[data-grid-cell="true"][data-weekday="1"][data-hour="10"]',
    ) as HTMLButtonElement | null;
    expect(cell).not.toBeNull();

    act(() => {
      cell!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Click Save → triggers ConflictError → conflict dialog opens.
    await act(async () => {
      findButtonByText('Save')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(findInDialogByText('Overlap detected')).not.toBeNull();

    // Click Override → re-invokes create with force=true.
    await act(async () => {
      findButtonByText('Override')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(2);
    const secondCall = mockCreateMutateAsync.mock.calls[1][0] as { force?: boolean };
    expect(secondCall.force).toBe(true);
  });
});
