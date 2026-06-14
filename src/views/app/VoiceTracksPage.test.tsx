import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'voiceTracks.title': 'Voice tracks',
        'voiceTracks.subtitle': 'Subtitle',
        'voiceTracks.newRecord': 'Record',
        'voiceTracks.newAi': 'AI generate',
        'voiceTracks.filter.all': 'All',
        'voiceTracks.status.draft': 'Draft',
        'voiceTracks.status.ready': 'Ready',
        'voiceTracks.status.aired': 'Aired',
        'voiceTracks.status.archived': 'Archived',
        'voiceTracks.empty.title': 'No voice tracks yet',
        'voiceTracks.empty.description': 'Record one to get started.',
        'voiceTracks.empty.action': 'New voice track',
        'voiceTracks.list.title': 'Title',
        'voiceTracks.list.duration': 'Duration',
        'voiceTracks.list.status': 'Status',
        'voiceTracks.list.created': 'Created',
        'voiceTracks.list.actions': 'Actions',
        'voiceTracks.actions.play': 'Play',
        'voiceTracks.actions.edit': 'Edit',
        'voiceTracks.actions.markReady': 'Mark ready',
        'voiceTracks.actions.archive': 'Archive',
        'voiceTracks.actions.delete': 'Delete',
        'voiceTracks.actions.deleteConfirm': 'Delete this voice track?',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

// Stub the radix Select to a plain native <select> so jsdom can drive it.
vi.mock('@/components/ui/select', () => {
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) {
    // Walk the children tree to collect the <SelectItem> values.
    const items: Array<{ value: string; label: ReactNode }> = [];
    function walk(node: ReactNode) {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node === 'object' && node !== null && 'props' in (node as object)) {
        const el = node as React.ReactElement<{ value?: string; children?: ReactNode }>;
        if (typeof el.props?.value === 'string') {
          items.push({ value: el.props.value, label: el.props.children });
        }
        if (el.props && 'children' in el.props) {
          walk(el.props.children);
        }
      }
    }
    walk(children);
    return (
      <select
        data-testid="vt-status-filter-shim"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
      >
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {typeof item.label === 'string' ? item.label : String(item.label)}
          </option>
        ))}
      </select>
    );
  }
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Select,
    SelectContent: passthrough,
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => (
      <span data-value={value}>{children}</span>
    ),
    SelectTrigger: passthrough,
    SelectValue: passthrough,
  };
});

// Stub the recorder so the page test doesn't need the MediaRecorder rig.
vi.mock('@/components/voice-tracks/VoiceTrackRecorder', () => ({
  VoiceTrackRecorder: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
  }) => (
    <div data-testid="vt-recorder-mock" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        data-testid="vt-recorder-mock-close"
        onClick={() => onOpenChange(false)}
      >
        close
      </button>
    </div>
  ),
}));

// Hook mocks — the page only consumes these three.
const useVoiceTracksMock = vi.fn();
const updateMutateMock = vi.fn();
const deleteMutateMock = vi.fn();

vi.mock('@/lib/voice-track-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/voice-track-queries')>(
    '@/lib/voice-track-queries',
  );
  return {
    ...actual,
    useVoiceTracks: (...args: unknown[]) => useVoiceTracksMock(...args),
    useUpdateVoiceTrack: () => ({ mutate: updateMutateMock, isPending: false }),
    useDeleteVoiceTrack: () => ({ mutate: deleteMutateMock, isPending: false }),
  };
});

import { OPEN_VT_AI_DRAWER_EVENT, VoiceTracksPage } from './VoiceTracksPage';
import type { VoiceTrackRow } from '@/lib/voice-track-queries';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function mount(element: ReactNode): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

function unmount({ container, root }: Rendered) {
  act(() => {
    root.unmount();
  });
  if (container.parentNode) container.parentNode.removeChild(container);
}

function setVoiceTracksState(state: {
  tracks?: VoiceTrackRow[];
  isLoading?: boolean;
  isError?: boolean;
}) {
  useVoiceTracksMock.mockReturnValue({
    data: state.tracks
      ? {
          pages: [{ voiceTracks: state.tracks, meta: { nextCursor: null, limit: 50 } }],
          pageParams: [null],
        }
      : undefined,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.isError ? new Error('boom') : null,
    refetch: vi.fn(),
  });
}

function makeTrack(over: Partial<VoiceTrackRow> & { id: string }): VoiceTrackRow {
  return {
    id: over.id,
    stationId: 's1',
    recordedBy: null,
    storageKey: `voice-tracks/s1/${over.id}.webm`,
    streamUrl: `/api/voice-tracks/${over.id}/audio`,
    durationMs: over.durationMs ?? 12000,
    transcript: over.transcript ?? null,
    targetClockSlotId: null,
    status: over.status ?? 'draft',
    aiGenerated: over.aiGenerated ?? 0,
    createdAt: over.createdAt ?? '2026-05-12T00:00:00Z',
  };
}

const rendered: Rendered[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) unmount(r);
  }
});

describe('VoiceTracksPage', () => {
  test('given API returns empty list > renders EmptyState', () => {
    setVoiceTracksState({ tracks: [] });
    const r = mount(<VoiceTracksPage />);
    rendered.push(r);
    expect(r.container.textContent ?? '').toContain('No voice tracks yet');
    // Header still renders the action buttons.
    expect(r.container.querySelector('[data-testid="vt-new-record"]')).toBeTruthy();
    expect(r.container.querySelector('[data-testid="vt-new-ai"]')).toBeTruthy();
  });

  test('given API returns 2 tracks > renders 2 rows', () => {
    setVoiceTracksState({
      tracks: [
        makeTrack({ id: 'a', transcript: 'One' }),
        makeTrack({ id: 'b', transcript: 'Two' }),
      ],
    });
    const r = mount(<VoiceTracksPage />);
    rendered.push(r);
    const rows = r.container.querySelectorAll('tbody > tr');
    expect(rows.length).toBe(2);
  });

  test('given filter change > re-invokes useVoiceTracks with new filter', () => {
    setVoiceTracksState({ tracks: [] });
    const r = mount(<VoiceTracksPage />);
    rendered.push(r);

    // First call: `all` → empty filters.
    expect(useVoiceTracksMock.mock.calls.length).toBeGreaterThan(0);
    const initial = useVoiceTracksMock.mock.calls[0][0];
    expect(initial).toEqual({});

    const sel = r.container.querySelector(
      '[data-testid="vt-status-filter-shim"]',
    ) as HTMLSelectElement;
    expect(sel).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      )?.set;
      setter?.call(sel, 'ready');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // The latest call should reflect the new filter.
    const latest = useVoiceTracksMock.mock.calls[useVoiceTracksMock.mock.calls.length - 1][0];
    expect(latest).toEqual({ status: 'ready' });
  });

  test('given Record click > opens the recorder modal', () => {
    setVoiceTracksState({ tracks: [] });
    const r = mount(<VoiceTracksPage />);
    rendered.push(r);
    let recorder = r.container.querySelector('[data-testid="vt-recorder-mock"]');
    expect(recorder?.getAttribute('data-open')).toBe('false');
    act(() => {
      (r.container.querySelector('[data-testid="vt-new-record"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    recorder = r.container.querySelector('[data-testid="vt-recorder-mock"]');
    expect(recorder?.getAttribute('data-open')).toBe('true');
  });

  test('given AI generate click > dispatches the open-vt-ai-drawer custom event', () => {
    setVoiceTracksState({ tracks: [] });
    const r = mount(<VoiceTracksPage />);
    rendered.push(r);
    const listener = vi.fn();
    window.addEventListener(OPEN_VT_AI_DRAWER_EVENT, listener);
    act(() => {
      (r.container.querySelector('[data-testid="vt-new-ai"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    window.removeEventListener(OPEN_VT_AI_DRAWER_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
    const evt = listener.mock.calls[0][0] as Event;
    expect(evt.type).toBe(OPEN_VT_AI_DRAWER_EVENT);
  });

  test('given loading state > renders skeletons', () => {
    setVoiceTracksState({ isLoading: true });
    const r = mount(<VoiceTracksPage />);
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="vt-loading"]')).toBeTruthy();
  });

  test('given error state > renders EmptyState with refetch action', () => {
    setVoiceTracksState({ isError: true });
    const r = mount(<VoiceTracksPage />);
    rendered.push(r);
    expect(r.container.textContent ?? '').toContain('No voice tracks yet');
    // Error message should surface in the description.
    expect(r.container.textContent ?? '').toContain('boom');
  });
});
