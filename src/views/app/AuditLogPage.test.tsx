import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Stub i18n with the keys the page touches.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'auditLog.title': 'Activity log',
        'auditLog.subtitle': 'Every change to the station.',
        'auditLog.exportCsv': 'Export CSV',
        'auditLog.filter.all': 'All actions',
        'auditLog.filter.actor': 'Actor',
        'auditLog.filter.action': 'Action type',
        'auditLog.filter.target': 'Target type',
        'auditLog.filter.from': 'From',
        'auditLog.filter.to': 'To',
        'auditLog.filter.search': 'Search payload',
        'auditLog.list.at': 'Time',
        'auditLog.list.actor': 'Actor',
        'auditLog.list.action': 'Action',
        'auditLog.list.target': 'Target',
        'auditLog.list.details': 'Details',
        'auditLog.diff.before': 'Before',
        'auditLog.diff.after': 'After',
        'auditLog.empty.title': 'No activity yet',
        'auditLog.empty.description': 'Actions across the app will appear here.',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// Radix Select shim — see comments in AuditLogFilters.test.tsx.
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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

// Stub the queries module so the page test never hits the network or
// TanStack's full machinery.
const useAuditLogMock = vi.fn();
const csvMutateMock = vi.fn();
let csvIsPending = false;

vi.mock('@/lib/audit-log-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audit-log-queries')>(
    '@/lib/audit-log-queries',
  );
  return {
    ...actual,
    useAuditLog: (filters: unknown) => useAuditLogMock(filters),
    useAuditLogCsvExport: () => ({
      mutate: csvMutateMock,
      get isPending() {
        return csvIsPending;
      },
    }),
  };
});

import { AuditLogPage } from './AuditLogPage';

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

function setQueryState(state: {
  entries?: Array<{
    id: string;
    at: string;
    actor: { userId: string | null; username: string | null };
    action: string;
    targetType: string;
    targetId: string;
    before: unknown;
    after: unknown;
  }>;
  isLoading?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  fetchNextPage?: ReturnType<typeof vi.fn>;
}) {
  const pages =
    state.entries === undefined
      ? []
      : [{ entries: state.entries, meta: { nextCursor: null, limit: 50 } }];
  useAuditLogMock.mockReturnValue({
    data: { pages, pageParams: [null] },
    isLoading: state.isLoading ?? false,
    hasNextPage: state.hasNextPage ?? false,
    isFetchingNextPage: state.isFetchingNextPage ?? false,
    fetchNextPage: state.fetchNextPage ?? vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  csvIsPending = false;
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('AuditLogPage', () => {
  test('renders the title + subtitle from i18n', () => {
    setQueryState({ entries: [] });
    const r = render(<AuditLogPage />);
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="audit-log-title"]')?.textContent).toBe(
      'Activity log',
    );
    expect(r.container.textContent ?? '').toContain('Every change to the station.');
  });

  test('given the export button is clicked > calls the CSV mutation and triggers a download', () => {
    setQueryState({
      entries: [
        {
          id: 'a1',
          at: '2026-05-13T10:00:00Z',
          actor: { userId: 'u1', username: 'demo' },
          action: 'create',
          targetType: 'clock',
          targetId: 'clock-1',
          before: null,
          after: { name: 'A' },
        },
      ],
    });

    // Capture URL.createObjectURL so we can assert the blob path.
    const createUrl = vi.fn(() => 'blob:mock-url');
    const revokeUrl = vi.fn();
    // jsdom provides URL; assign the stubs without changing the global type.
    (URL as unknown as { createObjectURL: typeof createUrl }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: typeof revokeUrl }).revokeObjectURL = revokeUrl;

    csvMutateMock.mockImplementation((_filters, opts) => {
      const blob = new Blob(['At,Actor,Action\n2026-05-13T10:00:00Z,demo,create\n'], {
        type: 'text/csv',
      });
      opts?.onSuccess?.(blob);
    });

    const r = render(<AuditLogPage />);
    rendered.push(r);

    const btn = r.container.querySelector(
      '[data-testid="audit-log-export-button"]',
    ) as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    act(() => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(csvMutateMock).toHaveBeenCalledTimes(1);
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  test('given a filter change > the query hook is invoked with the next filters object', () => {
    setQueryState({ entries: [] });
    const r = render(<AuditLogPage />);
    rendered.push(r);

    // First call recorded with empty filters during initial render.
    const initialCallCount = useAuditLogMock.mock.calls.length;
    expect(initialCallCount).toBeGreaterThan(0);
    expect(useAuditLogMock.mock.calls[0][0]).toEqual({});

    // Pick an action from the action dropdown — that bumps state and re-runs
    // the hook with the new filters.
    const selects = r.container.querySelectorAll('[data-testid="select-mock"]');
    const actionSelect = selects[0] as HTMLSelectElement;
    expect(actionSelect).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(actionSelect, 'create');
      actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // The last hook invocation should include the picked action.
    const last = useAuditLogMock.mock.calls[useAuditLogMock.mock.calls.length - 1];
    expect(last[0]).toEqual(expect.objectContaining({ action: 'create' }));
  });
});
