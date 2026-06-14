import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c1' }),
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
    t: (key: string, opts?: { minutes?: number; target?: number }) => {
      if (key === 'clocks.totalDuration') return `Total: ${opts?.minutes ?? 0} min`;
      if (key === 'clocks.preview.estimated')
        return `~ ${opts?.minutes ?? 0} min of ${opts?.target ?? 0} min target`;
      if (key === 'clocks.preview.overflow') return `Over by ${opts?.minutes ?? 0} min`;
      if (key === 'clocks.preview.underflow') return `Under by ${opts?.minutes ?? 0} min`;
      const map: Record<string, string> = {
        'clocks.title': 'Hour clocks',
        'clocks.save': 'Save',
        'clocks.discard': 'Discard',
        'clocks.delete': 'Delete clock',
        'clocks.deleteConfirm': 'Are you sure?',
        'clocks.saved': 'Saved',
        'clocks.dirty': 'Unsaved changes',
        'clocks.untitledClock': 'Untitled clock',
        'clocks.canvasEmpty': 'Drag a slot from the left to start building this hour.',
        'clocks.slot.category': 'Category',
        'clocks.slot.duration': 'Duration (s)',
        'clocks.slot.remove': 'Remove slot',
        'clocks.slot.noCategory': '(no category)',
        'clocks.preview.title': 'Live preview',
        'clocks.slotPalette.title': 'Slot types',
        'clocks.slotPalette.music': 'Music',
        'clocks.slotPalette.sweeper': 'Sweeper',
        'clocks.slotPalette.liner': 'Liner',
        'clocks.slotPalette.vt': 'Voice track',
        'clocks.slotPalette.id': 'Station ID',
        'clocks.slotPalette.news': 'News',
        'clocks.slotPalette.weather': 'Weather',
        'clocks.slotPalette.spot': 'Spot / ad',
        'clocks.slotPalette.bed': 'Bed',
        'clocks.slotPalette.custom': 'Custom',
        'clocks.emptyState.title': 'No clocks yet',
        'clocks.emptyState.description': 'Build one to get started.',
        'clocks.emptyState.action': 'Create clock',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

const useClockMock = vi.fn();
const updateClockMutateAsync = vi.fn();
const deleteClockMutate = vi.fn();
const addSlotMutateAsync = vi.fn();
const updateSlotMutateAsync = vi.fn();
const deleteSlotMutateAsync = vi.fn();
const reorderSlotsMutateAsync = vi.fn();

vi.mock('@/lib/clock-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/clock-queries')>('@/lib/clock-queries');
  return {
    ...actual,
    useClock: () => useClockMock(),
    useUpdateClock: () => ({ mutateAsync: updateClockMutateAsync }),
    useDeleteClock: () => ({ mutate: deleteClockMutate }),
    useAddSlot: () => ({ mutateAsync: addSlotMutateAsync }),
    useUpdateSlot: () => ({ mutateAsync: updateSlotMutateAsync }),
    useDeleteSlot: () => ({ mutateAsync: deleteSlotMutateAsync }),
    useReorderSlots: () => ({ mutateAsync: reorderSlotsMutateAsync }),
  };
});

// Stub AlertDialog to render children when open.
vi.mock('@/components/ui/alert-dialog', () => {
  function AlertDialog({ open, children }: { open: boolean; children: ReactNode }) {
    return open ? <div data-testid="alert-dialog-shim">{children}</div> : null;
  }
  function passthrough({ children, onClick, ...rest }: { children: ReactNode; onClick?: () => void } & Record<string, unknown>) {
    return <div onClick={onClick} {...rest}>{children}</div>;
  }
  return {
    AlertDialog,
    AlertDialogTrigger: passthrough,
    AlertDialogContent: passthrough,
    AlertDialogHeader: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogTitle: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
    AlertDialogAction: ({ children, onClick, ...rest }: { children: ReactNode; onClick?: () => void } & Record<string, unknown>) => (
      <button type="button" onClick={onClick} {...rest}>{children}</button>
    ),
  };
});

import { ClockBuilderPage, computeSaveDiff } from './ClockBuilderPage';
import type { ClockDetail } from '@/lib/clock-queries';

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

function makeClockDetail(over: Partial<ClockDetail> & { id: string }): ClockDetail {
  return {
    id: over.id,
    stationId: 'urban-radio',
    name: over.name ?? 'Morning Mix',
    color: over.color ?? '#3b82f6',
    targetDurationMs: over.targetDurationMs ?? 3_600_000,
    createdAt: over.createdAt ?? '2026-05-01T00:00:00Z',
    slots: over.slots ?? [],
  };
}

function setClockState(state: {
  data?: ClockDetail;
  isLoading?: boolean;
  isError?: boolean;
}) {
  useClockMock.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    refetch: vi.fn(),
  });
}

const rendered: Rendered[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  updateClockMutateAsync.mockResolvedValue({});
  deleteSlotMutateAsync.mockResolvedValue(undefined);
  updateSlotMutateAsync.mockResolvedValue({ ok: true });
  reorderSlotsMutateAsync.mockResolvedValue({ ok: true });
  addSlotMutateAsync.mockImplementation(async (input) => ({
    slot: {
      id: `srv-${input.slotType}-${input.position}`,
      position: input.position,
      slotType: input.slotType,
      categoryId: input.categoryId ?? null,
      durationEstimateMs: input.durationEstimateMs,
      rulesJson: input.rulesJson ?? null,
    },
  }));
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('computeSaveDiff', () => {
  test('no changes > empty diff', () => {
    const server = makeClockDetail({ id: 'c1' });
    const diff = computeSaveDiff(server, {
      name: server.name,
      color: server.color,
      targetDurationMs: server.targetDurationMs,
      slots: [],
    });
    expect(diff.metadataPatch).toBeNull();
    expect(diff.toAdd).toEqual([]);
    expect(diff.toDelete).toEqual([]);
    expect(diff.toUpdate).toEqual([]);
  });

  test('renamed clock > metadataPatch.name', () => {
    const server = makeClockDetail({ id: 'c1' });
    const diff = computeSaveDiff(server, {
      name: 'New Name',
      color: server.color,
      targetDurationMs: server.targetDurationMs,
      slots: [],
    });
    expect(diff.metadataPatch).toEqual({ name: 'New Name' });
  });

  test('local slot present > shows in toAdd', () => {
    const server = makeClockDetail({ id: 'c1' });
    const diff = computeSaveDiff(server, {
      name: server.name,
      color: server.color,
      targetDurationMs: server.targetDurationMs,
      slots: [
        {
          id: 'local-1',
          position: 0,
          slotType: 'music',
          categoryId: null,
          durationEstimateMs: 180_000,
          rulesJson: null,
          isLocal: true,
        },
      ],
    });
    expect(diff.toAdd).toHaveLength(1);
    expect(diff.toAdd[0].tempId).toBe('local-1');
  });

  test('server slot removed from draft > listed in toDelete', () => {
    const server = makeClockDetail({
      id: 'c1',
      slots: [
        {
          id: 's1',
          position: 0,
          slotType: 'music',
          categoryId: null,
          durationEstimateMs: 60_000,
          rulesJson: null,
        },
      ],
    });
    const diff = computeSaveDiff(server, {
      name: server.name,
      color: server.color,
      targetDurationMs: server.targetDurationMs,
      slots: [],
    });
    expect(diff.toDelete).toEqual(['s1']);
  });

  test('server slot duration changed > listed in toUpdate', () => {
    const server = makeClockDetail({
      id: 'c1',
      slots: [
        {
          id: 's1',
          position: 0,
          slotType: 'music',
          categoryId: null,
          durationEstimateMs: 60_000,
          rulesJson: null,
        },
      ],
    });
    const diff = computeSaveDiff(server, {
      name: server.name,
      color: server.color,
      targetDurationMs: server.targetDurationMs,
      slots: [
        {
          id: 's1',
          position: 0,
          slotType: 'music',
          categoryId: null,
          durationEstimateMs: 90_000,
          rulesJson: null,
          isLocal: false,
        },
      ],
    });
    expect(diff.toUpdate).toEqual([{ id: 's1', patch: { durationEstimateMs: 90_000 } }]);
  });
});

describe('ClockBuilderPage', () => {
  test('given API returns clock > renders with name in input', () => {
    setClockState({ data: makeClockDetail({ id: 'c1', name: 'Morning Mix' }) });
    const r = render(<ClockBuilderPage />);
    rendered.push(r);
    const nameInput = r.container.querySelector(
      '[data-testid="builder-name"]',
    ) as HTMLInputElement | null;
    expect(nameInput?.value).toBe('Morning Mix');
  });

  test('given fresh load > dirty=false, save/discard disabled', () => {
    setClockState({ data: makeClockDetail({ id: 'c1' }) });
    const r = render(<ClockBuilderPage />);
    rendered.push(r);
    const indicator = r.container.querySelector('[data-testid="builder-dirty-indicator"]');
    expect(indicator?.textContent ?? '').toContain('Saved');
    const save = r.container.querySelector('[data-testid="builder-save"]') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  test('given palette chip clicked > dirty=true and slot added to draft', () => {
    setClockState({ data: makeClockDetail({ id: 'c1' }) });
    const r = render(<ClockBuilderPage />);
    rendered.push(r);
    const musicChip = r.container.querySelector(
      '[data-testid="palette-chip-music"]',
    ) as HTMLButtonElement | null;
    expect(musicChip).toBeTruthy();
    act(() => {
      musicChip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const indicator = r.container.querySelector('[data-testid="builder-dirty-indicator"]');
    expect(indicator?.textContent ?? '').toContain('Unsaved changes');
    // Canvas now has 1 slot — the empty hint is gone.
    expect(r.container.querySelector('[data-testid="canvas-empty"]')).toBeNull();
    const canvasSlots = r.container.querySelectorAll('[data-slot-id]');
    expect(canvasSlots.length).toBe(1);
  });

  test('given Save with new slot > calls useAddSlot', async () => {
    setClockState({ data: makeClockDetail({ id: 'c1' }) });
    const r = render(<ClockBuilderPage />);
    rendered.push(r);
    // Add slot
    act(() => {
      (r.container.querySelector('[data-testid="palette-chip-sweeper"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // Save
    const saveBtn = r.container.querySelector(
      '[data-testid="builder-save"]',
    ) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    await act(async () => {
      saveBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // let microtasks flush
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(addSlotMutateAsync).toHaveBeenCalledTimes(1);
    const [arg] = addSlotMutateAsync.mock.calls[0];
    expect(arg).toMatchObject({ clockId: 'c1', slotType: 'sweeper' });
  });

  test('given Discard with dirty draft > resets to server state', () => {
    setClockState({ data: makeClockDetail({ id: 'c1', name: 'Morning Mix' }) });
    const r = render(<ClockBuilderPage />);
    rendered.push(r);

    // Edit name
    const nameInput = r.container.querySelector(
      '[data-testid="builder-name"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    act(() => {
      setter?.call(nameInput, 'Renamed');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(
      r.container.querySelector('[data-testid="builder-dirty-indicator"]')?.textContent ?? '',
    ).toContain('Unsaved changes');

    // Discard
    const discardBtn = r.container.querySelector(
      '[data-testid="builder-discard"]',
    ) as HTMLButtonElement;
    act(() => {
      discardBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const after = r.container.querySelector(
      '[data-testid="builder-name"]',
    ) as HTMLInputElement;
    expect(after.value).toBe('Morning Mix');
    expect(
      r.container.querySelector('[data-testid="builder-dirty-indicator"]')?.textContent ?? '',
    ).toContain('Saved');
  });

  test('given Delete confirm > calls useDeleteClock and redirects', () => {
    setClockState({ data: makeClockDetail({ id: 'c1' }) });
    deleteClockMutate.mockImplementation((_id, opts) => {
      opts?.onSuccess?.();
    });
    const r = render(<ClockBuilderPage />);
    rendered.push(r);
    // Open dialog
    act(() => {
      (r.container.querySelector('[data-testid="builder-delete"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const confirm = r.container.querySelector(
      '[data-testid="builder-delete-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirm).toBeTruthy();
    act(() => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(deleteClockMutate).toHaveBeenCalledWith('c1', expect.any(Object));
    expect(pushMock).toHaveBeenCalledWith('/app/clocks');
  });
});
