import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
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
        'voiceTracks.status.draft': 'Draft',
        'voiceTracks.status.ready': 'Ready',
        'voiceTracks.status.aired': 'Aired',
        'voiceTracks.status.archived': 'Archived',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// Stub the Radix DropdownMenu so test code can interact with items without
// dealing with the portal/popover lifecycle in jsdom.
vi.mock('@/components/ui/dropdown-menu', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: passthrough,
    DropdownMenuItem: ({
      children,
      onSelect,
      className,
      'data-testid': testId,
    }: {
      children?: ReactNode;
      onSelect?: () => void;
      className?: string;
      'data-testid'?: string;
    }) => (
      <button
        type="button"
        data-testid={testId}
        className={className}
        onClick={() => onSelect?.()}
      >
        {children}
      </button>
    ),
    DropdownMenuSeparator: () => <hr />,
  };
});

import { VoiceTrackList } from './VoiceTrackList';
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

function makeTrack(over: Partial<VoiceTrackRow> & { id: string }): VoiceTrackRow {
  return {
    id: over.id,
    stationId: over.stationId ?? 's1',
    recordedBy: over.recordedBy ?? null,
    storageKey: over.storageKey ?? `voice-tracks/s1/${over.id}.webm`,
    streamUrl: over.streamUrl ?? `/api/voice-tracks/${over.id}/audio`,
    durationMs: over.durationMs ?? 12000,
    transcript: over.transcript ?? null,
    targetClockSlotId: over.targetClockSlotId ?? null,
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

describe('VoiceTrackList', () => {
  test('given empty tracks > renders EmptyState with action when callback supplied', () => {
    const onCreateClick = vi.fn();
    const r = mount(
      <VoiceTrackList tracks={[]} onCreateClick={onCreateClick} />,
    );
    rendered.push(r);
    expect(r.container.textContent ?? '').toContain('No voice tracks yet');
    // Table must not render when empty.
    expect(r.container.querySelector('[data-testid="vt-list"]')).toBeNull();
  });

  test('given 3 tracks > renders 3 rows in the table', () => {
    const tracks = [
      makeTrack({ id: 'a', transcript: 'Hello listeners' }),
      makeTrack({ id: 'b', status: 'ready' }),
      makeTrack({ id: 'c', aiGenerated: 1 }),
    ];
    const r = mount(<VoiceTrackList tracks={tracks} />);
    rendered.push(r);
    const rows = r.container.querySelectorAll('[data-testid^="vt-row-"]');
    // Each row has a `tr` plus inner testids; we count the parent rows.
    const trRows = Array.from(r.container.querySelectorAll('tbody > tr'));
    expect(trRows).toHaveLength(3);
    expect(r.container.textContent ?? '').toContain('Hello listeners');
    // Sanity: at least one row has a "Ready" badge label.
    expect(r.container.textContent ?? '').toContain('Ready');
    // The "AI" pill renders for tracks where aiGenerated === 1.
    expect(r.container.textContent ?? '').toContain('AI');
    // Quick sanity-check: ensure something rendered for the row.
    expect(rows.length).toBeGreaterThan(0);
  });

  test('given row Play click on the title > calls onPlay with the track', () => {
    const onPlay = vi.fn();
    const tracks = [makeTrack({ id: 'a', transcript: 'Click me' })];
    const r = mount(<VoiceTrackList tracks={tracks} onPlay={onPlay} />);
    rendered.push(r);
    const titleBtn = r.container.querySelector(
      '[data-testid="vt-row-title-a"]',
    ) as HTMLButtonElement;
    expect(titleBtn).toBeTruthy();
    act(() => {
      titleBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledWith(tracks[0]);
  });

  test('given Delete menu click + confirm > calls onDelete with id', () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const tracks = [makeTrack({ id: 'a' })];
    const r = mount(<VoiceTrackList tracks={tracks} onDelete={onDelete} />);
    rendered.push(r);
    const deleteBtn = r.container.querySelector(
      '[data-testid="vt-row-delete-a"]',
    ) as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();
    act(() => {
      deleteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('a');
    confirmSpy.mockRestore();
  });

  test('given Delete menu click + cancel > does NOT call onDelete', () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const tracks = [makeTrack({ id: 'a' })];
    const r = mount(<VoiceTrackList tracks={tracks} onDelete={onDelete} />);
    rendered.push(r);
    const deleteBtn = r.container.querySelector(
      '[data-testid="vt-row-delete-a"]',
    ) as HTMLButtonElement;
    act(() => {
      deleteBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  test('given track with status=ready > does not render mark-ready menu item', () => {
    const tracks = [makeTrack({ id: 'a', status: 'ready' })];
    const r = mount(<VoiceTrackList tracks={tracks} />);
    rendered.push(r);
    // Mark-ready item is hidden when the track is already ready.
    expect(r.container.querySelector('[data-testid="vt-row-mark-ready-a"]')).toBeNull();
    // But archive is still available.
    expect(r.container.querySelector('[data-testid="vt-row-archive-a"]')).toBeTruthy();
  });
});
