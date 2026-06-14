import { afterEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ConflictError, type ScheduleAssignment } from '@/lib/schedule-queries';
import type { ClockRow } from '@/lib/clock-queries';

// Stub the schedule-queries mutation hooks. We expose mockCreateMutate / mockUpdateMutate
// for assertions and let tests reconfigure their return values per test.
const mockCreateMutateAsync = vi.fn<(input: unknown) => Promise<{ assignment: ScheduleAssignment }>>();
const mockUpdateMutateAsync = vi.fn<(input: unknown) => Promise<{ assignment: ScheduleAssignment }>>();

vi.mock('@/lib/schedule-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/schedule-queries')>(
    '@/lib/schedule-queries',
  );
  return {
    ...actual,
    useCreateAssignment: () => ({
      mutateAsync: mockCreateMutateAsync,
      isPending: false,
    }),
    useUpdateAssignment: () => ({
      mutateAsync: mockUpdateMutateAsync,
      isPending: false,
    }),
  };
});

// Stub clocks hook — controllable per test via the variable below.
let stubClocks: ClockRow[] = [];
vi.mock('@/lib/clock-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/clock-queries')>(
    '@/lib/clock-queries',
  );
  return {
    ...actual,
    useClocks: () => ({ data: { clocks: stubClocks } }),
  };
});

// Stub next/link to avoid router context.
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href} data-stub-link="true">
      {children}
    </a>
  ),
}));

// Stub the RRuleEditor to keep this test focused on dialog wiring.
vi.mock('./RRuleEditor', () => ({
  RRuleEditor: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (next: string | null) => void;
  }) => (
    <button
      type="button"
      data-stub-rrule-editor="true"
      data-current={value ?? 'null'}
      onClick={() => onChange('FREQ=DAILY')}
    >
      rrule-stub
    </button>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'schedule.selectClock': 'Choose a clock to assign',
        'schedule.noClocksHint': 'Create an hour clock first.',
        'schedule.createClock': 'Go to clocks',
        'schedule.validRange.from': 'Valid from',
        'schedule.validRange.until': 'Valid until',
        'schedule.weekdays.sun': 'Sun',
        'schedule.weekdays.mon': 'Mon',
        'schedule.weekdays.tue': 'Tue',
        'schedule.weekdays.wed': 'Wed',
        'schedule.weekdays.thu': 'Thu',
        'schedule.weekdays.fri': 'Fri',
        'schedule.weekdays.sat': 'Sat',
        'schedule.actions.delete': 'Delete assignment',
        'clocks.save': 'Save',
        'settings.actions.cancel': 'Cancel',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { AssignClockDialog } from './AssignClockDialog';

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

function findLinkByText(text: string): HTMLAnchorElement | null {
  const all = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[];
  return all.find((a) => (a.textContent ?? '').includes(text)) ?? null;
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

const rendered: Rendered[] = [];

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
  mockCreateMutateAsync.mockReset();
  mockUpdateMutateAsync.mockReset();
  stubClocks = [];
});

describe('AssignClockDialog', () => {
  test('given no clocks > shows noClocksHint and Create link', () => {
    stubClocks = [];

    const r = render(
      <AssignClockDialog
        open
        mode="create"
        weekday={1}
        hour={10}
        onClose={() => {}}
        onConflict={() => {}}
        onSuccess={() => {}}
      />,
    );
    rendered.push(r);

    expect(findInDialogByText('Create an hour clock first.')).not.toBeNull();
    const link = findLinkByText('Go to clocks');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/app/clocks');
  });

  test('given submit > calls useCreateAssignment', async () => {
    stubClocks = [makeClock('c1', 'Morning Drive')];
    mockCreateMutateAsync.mockResolvedValue({
      assignment: makeAssignment({ clockId: 'c1', weekday: 1, hour: 10 }),
    });

    const r = render(
      <AssignClockDialog
        open
        mode="create"
        weekday={1}
        hour={10}
        onClose={() => {}}
        onConflict={() => {}}
        onSuccess={() => {}}
      />,
    );
    rendered.push(r);

    const saveBtn = findButtonByText('Save');
    expect(saveBtn).not.toBeNull();

    await act(async () => {
      saveBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockCreateMutateAsync).toHaveBeenCalled();
    const arg = mockCreateMutateAsync.mock.calls[0][0] as {
      clockId: string;
      weekday: number;
      hour: number;
    };
    expect(arg.clockId).toBe('c1');
    expect(arg.weekday).toBe(1);
    expect(arg.hour).toBe(10);
  });

  test('given submit returns ConflictError > calls onConflict with conflicts + attempted submission', async () => {
    stubClocks = [makeClock('c1', 'Morning')];
    const conflicts = [makeAssignment({ id: 'existing', clockId: 'other' })];
    mockCreateMutateAsync.mockRejectedValue(new ConflictError(conflicts));

    const onConflict = vi.fn();
    const r = render(
      <AssignClockDialog
        open
        mode="create"
        weekday={1}
        hour={10}
        onClose={() => {}}
        onConflict={onConflict}
        onSuccess={() => {}}
      />,
    );
    rendered.push(r);

    const saveBtn = findButtonByText('Save');
    expect(saveBtn).not.toBeNull();

    await act(async () => {
      saveBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onConflict).toHaveBeenCalledTimes(1);
    const calledWith = onConflict.mock.calls[0][0] as ScheduleAssignment[];
    expect(calledWith[0].id).toBe('existing');
    // Attempted submission is the second arg — contains the input we tried.
    const attempted = onConflict.mock.calls[0][1] as {
      mode: 'create' | 'edit';
      input: { clockId: string; weekday: number; hour: number };
    };
    expect(attempted.mode).toBe('create');
    expect(attempted.input.clockId).toBe('c1');
    expect(attempted.input.weekday).toBe(1);
    expect(attempted.input.hour).toBe(10);
  });

  test('given edit mode > prefills fields from the assignment', () => {
    stubClocks = [makeClock('c1', 'Morning'), makeClock('c2', 'Evening')];
    const a = makeAssignment({
      id: 'a-edit',
      clockId: 'c2',
      weekday: 3,
      hour: 18,
      rrule: 'FREQ=DAILY',
    });

    const r = render(
      <AssignClockDialog
        open
        mode="edit"
        assignment={a}
        weekday={a.weekday}
        hour={a.hour}
        onClose={() => {}}
        onConflict={() => {}}
        onSuccess={() => {}}
      />,
    );
    rendered.push(r);

    // The hidden form-state for clock selection should reflect c2.
    const stateInput = document.querySelector('[data-form-clock-id]');
    expect(stateInput).not.toBeNull();
    expect(stateInput!.getAttribute('data-form-clock-id')).toBe('c2');

    // RRule stub reports current value.
    const rruleStub = document.querySelector('[data-stub-rrule-editor="true"]');
    expect(rruleStub).not.toBeNull();
    expect(rruleStub!.getAttribute('data-current')).toBe('FREQ=DAILY');
  });

  test('given edit mode submit > calls useUpdateAssignment with id and patch', async () => {
    stubClocks = [makeClock('c1', 'Morning')];
    const a = makeAssignment({ id: 'a-edit', clockId: 'c1', weekday: 1, hour: 9 });
    mockUpdateMutateAsync.mockResolvedValue({ assignment: a });

    const r = render(
      <AssignClockDialog
        open
        mode="edit"
        assignment={a}
        weekday={a.weekday}
        hour={a.hour}
        onClose={() => {}}
        onConflict={() => {}}
        onSuccess={() => {}}
      />,
    );
    rendered.push(r);

    const saveBtn = findButtonByText('Save');
    expect(saveBtn).not.toBeNull();
    await act(async () => {
      saveBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(mockUpdateMutateAsync).toHaveBeenCalled();
    const arg = mockUpdateMutateAsync.mock.calls[0][0] as { id: string };
    expect(arg.id).toBe('a-edit');
  });
});
