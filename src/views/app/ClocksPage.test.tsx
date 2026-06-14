import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

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

vi.mock('next/link', () => ({
  default: ({ children, href, className, ...rest }: { children: ReactNode; href: string; className?: string } & Record<string, unknown>) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { minutes?: number }) => {
      const map: Record<string, string> = {
        'clocks.title': 'Hour clocks',
        'clocks.subtitle': 'Subtitle',
        'clocks.newClock': 'New clock',
        'clocks.save': 'Save',
        'clocks.discard': 'Discard',
        'clocks.untitledClock': 'Untitled clock',
        'clocks.saved': 'Saved',
        'clocks.emptyState.title': 'No clocks yet',
        'clocks.emptyState.description': 'Build one to get started.',
        'clocks.emptyState.action': 'Create clock',
      };
      if (key === 'clocks.totalDuration') return `Total: ${opts?.minutes ?? 0} min`;
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

const useClocksMock = vi.fn();
const createMutateMock = vi.fn();
let createIsPendingMock = false;

vi.mock('@/lib/clock-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/clock-queries')>('@/lib/clock-queries');
  return {
    ...actual,
    useClocks: () => useClocksMock(),
    useCreateClock: () => ({
      mutate: createMutateMock,
      get isPending() {
        return createIsPendingMock;
      },
    }),
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

// Stub Dialog to render children inline — radix portals can be flaky in jsdom
// and aren't what we're testing here. We just want the form to be visible
// when `open` is true.
vi.mock('@/components/ui/dialog', () => {
  function Dialog({ open, children }: { open: boolean; children: ReactNode }) {
    return open ? <div data-testid="dialog-shim">{children}</div> : null;
  }
  function passthrough({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  return {
    Dialog,
    DialogContent: passthrough,
    DialogHeader: passthrough,
    DialogFooter: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
    DialogTrigger: passthrough,
    DialogClose: passthrough,
    DialogPortal: passthrough,
    DialogOverlay: passthrough,
  };
});

import { ClocksPage } from './ClocksPage';
import type { ClockRow } from '@/lib/clock-queries';

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

function setClocksState(
  state: {
    data?: { clocks: ClockRow[] };
    isLoading?: boolean;
    isError?: boolean;
  } = {},
) {
  useClocksMock.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    refetch: vi.fn(),
  });
}

function makeClock(over: Partial<ClockRow> & { id: string }): ClockRow {
  return {
    id: over.id,
    name: over.name ?? `Clock ${over.id}`,
    color: over.color ?? '#3b82f6',
    targetDurationMs: over.targetDurationMs ?? 3_600_000,
    createdAt: over.createdAt ?? '2026-05-01T00:00:00Z',
  };
}

const rendered: Rendered[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  createIsPendingMock = false;
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ClocksPage', () => {
  test('given API returns no clocks > renders EmptyState', () => {
    setClocksState({ data: { clocks: [] } });
    const r = render(<ClocksPage />);
    rendered.push(r);
    expect(r.container.textContent ?? '').toContain('No clocks yet');
    expect(r.container.querySelectorAll('[data-testid^="clocks-card-"]').length).toBe(0);
  });

  test('given loading state > renders skeleton', () => {
    setClocksState({ isLoading: true });
    const r = render(<ClocksPage />);
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="clocks-loading"]')).toBeTruthy();
  });

  test('given API returns 3 clocks > renders 3 cards', () => {
    setClocksState({
      data: {
        clocks: [
          makeClock({ id: 'c1', name: 'Morning' }),
          makeClock({ id: 'c2', name: 'Midday' }),
          makeClock({ id: 'c3', name: 'Drive' }),
        ],
      },
    });
    const r = render(<ClocksPage />);
    rendered.push(r);
    const cards = r.container.querySelectorAll('[data-testid^="clocks-card-"]');
    expect(cards.length).toBe(3);
    expect(r.container.textContent ?? '').toContain('Morning');
    expect(r.container.textContent ?? '').toContain('Drive');
  });

  test('given New Clock click > opens dialog', () => {
    setClocksState({ data: { clocks: [makeClock({ id: 'c1' })] } });
    const r = render(<ClocksPage />);
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="dialog-shim"]')).toBeNull();
    const btn = r.container.querySelector(
      '[data-testid="clocks-new-button"]',
    ) as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    act(() => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(r.container.querySelector('[data-testid="dialog-shim"]')).toBeTruthy();
  });

  test('given create submit > calls useCreateClock and redirects on success', () => {
    setClocksState({ data: { clocks: [] } });
    // Capture the mutate callback so we can resolve it manually.
    createMutateMock.mockImplementation((_input, opts) => {
      opts?.onSuccess?.({ clock: makeClock({ id: 'new-1', name: 'Fresh' }) });
    });

    const r = render(<ClocksPage />);
    rendered.push(r);

    // Open dialog
    act(() => {
      (r.container.querySelector('[data-testid="clocks-new-button"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Fill name
    const nameInput = r.container.querySelector(
      '[data-testid="clocks-create-name"]',
    ) as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    act(() => setInputValue(nameInput, 'Fresh'));

    // Submit
    const submit = r.container.querySelector(
      '[data-testid="clocks-create-submit"]',
    ) as HTMLButtonElement;
    expect(submit).toBeTruthy();
    expect(submit.disabled).toBe(false);
    act(() => {
      submit.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(createMutateMock).toHaveBeenCalledTimes(1);
    const [input] = createMutateMock.mock.calls[0];
    expect(input).toMatchObject({ name: 'Fresh' });
    expect(pushMock).toHaveBeenCalledWith('/app/clocks/new-1');
  });
});
