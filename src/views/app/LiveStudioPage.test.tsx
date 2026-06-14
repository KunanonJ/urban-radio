import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { AudioGraph } from '@/lib/audio-graph';

// ── Mocks ────────────────────────────────────────────────────────────────────
// Stub the audio graph factory — Web Audio is not available in jsdom.
const createAudioGraphMock = vi.fn<() => AudioGraph>();
vi.mock('@/lib/audio-graph', async () => {
  const actual = await vi.importActual<typeof import('@/lib/audio-graph')>(
    '@/lib/audio-graph',
  );
  return {
    ...actual,
    createAudioGraph: () => createAudioGraphMock(),
  };
});

// Stub the parallel-agent components so their internals (which require the
// real AudioContext, the player store, etc.) don't bleed into this shell test.
let lastMixerProps: { graph: AudioGraph | null } | null = null;
vi.mock('@/components/live/Mixer', () => ({
  Mixer: (props: { graph: AudioGraph | null }) => {
    lastMixerProps = props;
    return (
      <div
        data-testid="mock-mixer"
        data-has-graph={props.graph ? 'true' : 'false'}
      />
    );
  },
}));

let lastStripLayout: string | undefined;
vi.mock('@/components/live/NowNextQueueStrip', () => ({
  NowNextQueueStrip: (props: { layout?: string }) => {
    lastStripLayout = props.layout;
    return <div data-testid="mock-strip" data-layout={props.layout ?? 'compact'} />;
  },
}));

vi.mock('@/components/live/LiveStudioHotkeys', () => ({
  LiveStudioHotkeys: () => <div data-testid="mock-hotkeys" />,
}));

// Stub HealthStrip + QuickVTPanel — these are mine, but the page tests should
// not double-test them. Just confirm they mount.
vi.mock('@/components/live/HealthStrip', () => ({
  HealthStrip: () => <div data-testid="mock-health-strip" />,
}));
vi.mock('@/components/live/QuickVTPanel', () => ({
  QuickVTPanel: () => <div data-testid="mock-quick-vt" />,
}));

// Stream-status hook stub (so the page can render even when the API is down).
type StreamStatusHookReturn = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
};
let streamStatusReturn: StreamStatusHookReturn = {
  data: undefined,
  isLoading: false,
  isError: false,
};
vi.mock('@/lib/stream-status-queries', () => ({
  useStreamStatus: () => streamStatusReturn,
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'liveStudio.title': 'Live studio',
        'liveStudio.subtitle': 'On-air controls',
        'liveStudio.layout.title': 'Layout',
        'liveStudio.layout.compact': 'Compact',
        'liveStudio.layout.wide': 'Wide',
        'liveStudio.layout.minimal': 'Minimal',
        'liveStudio.emptyState.title': 'Nothing on air',
        'liveStudio.emptyState.description': 'Start the queue.',
        'liveStudio.emptyState.action': 'Open scheduler',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

import { LiveStudioPage, LIVE_STUDIO_LAYOUT_STORAGE_KEY } from './LiveStudioPage';

(globalThis as typeof globalThis & {
  React?: typeof React;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function render(element: React.ReactElement): Rendered {
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

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  const all = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
  return all.find((b) => (b.textContent ?? '').trim() === text) ?? null;
}

const rendered: Rendered[] = [];

beforeEach(() => {
  createAudioGraphMock.mockReset();
  lastMixerProps = null;
  lastStripLayout = undefined;
  pushMock.mockReset();
  streamStatusReturn = { data: undefined, isLoading: false, isError: false };
  window.localStorage.clear();
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('LiveStudioPage', () => {
  test('renders title and subtitle', () => {
    const r = render(<LiveStudioPage />);
    rendered.push(r);

    expect(r.container.textContent ?? '').toContain('Live studio');
    expect(r.container.textContent ?? '').toContain('On-air controls');
  });

  test('renders strip, health, VT, and hotkeys bridges', () => {
    const r = render(<LiveStudioPage />);
    rendered.push(r);

    expect(r.container.querySelector('[data-testid="mock-strip"]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid="mock-health-strip"]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid="mock-quick-vt"]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid="mock-hotkeys"]')).not.toBeNull();
  });

  test('before Enable audio click > graph is null and mixer renders with graph=null', () => {
    const r = render(<LiveStudioPage />);
    rendered.push(r);

    // Mixer is still mounted (it tolerates graph=null and renders a disabled UI).
    const mixer = r.container.querySelector('[data-testid="mock-mixer"]');
    expect(mixer).not.toBeNull();
    expect(mixer?.getAttribute('data-has-graph')).toBe('false');

    // Audio graph factory was NOT called.
    expect(createAudioGraphMock).not.toHaveBeenCalled();
  });

  test('given Enable audio click > calls createAudioGraph and passes the graph to Mixer', () => {
    const fakeGraph = { __id: 'graph-1' } as unknown as AudioGraph;
    createAudioGraphMock.mockReturnValue(fakeGraph);

    const r = render(<LiveStudioPage />);
    rendered.push(r);

    const enableBtn = r.container.querySelector(
      '[data-testid="live-studio-enable-audio"]',
    ) as HTMLButtonElement | null;
    expect(enableBtn).not.toBeNull();

    act(() => {
      enableBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(createAudioGraphMock).toHaveBeenCalledTimes(1);
    expect(lastMixerProps?.graph).toBe(fakeGraph);
    const mixer = r.container.querySelector('[data-testid="mock-mixer"]');
    expect(mixer?.getAttribute('data-has-graph')).toBe('true');
  });

  test('given layout switch > persists to localStorage and propagates to strip', () => {
    const r = render(<LiveStudioPage />);
    rendered.push(r);

    // Default layout is compact, persisted on first mount.
    expect(lastStripLayout).toBe('compact');

    // Switch to "Wide".
    const wideBtn = findButtonByText(r.container, 'Wide');
    expect(wideBtn).not.toBeNull();

    act(() => {
      wideBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(window.localStorage.getItem(LIVE_STUDIO_LAYOUT_STORAGE_KEY)).toBe('wide');
    expect(lastStripLayout).toBe('wide');
  });

  test('given persisted layout in localStorage > rehydrates on mount', () => {
    window.localStorage.setItem(LIVE_STUDIO_LAYOUT_STORAGE_KEY, 'minimal');

    const r = render(<LiveStudioPage />);
    rendered.push(r);

    expect(lastStripLayout).toBe('minimal');
  });

  test('given /api/stream/status fails > still renders other surfaces (health pill shows error)', () => {
    streamStatusReturn = { data: undefined, isLoading: false, isError: true };

    const r = render(<LiveStudioPage />);
    rendered.push(r);

    // Health strip stub is mounted regardless of stream status.
    expect(r.container.querySelector('[data-testid="mock-health-strip"]')).not.toBeNull();
    // Mixer and strip still render.
    expect(r.container.querySelector('[data-testid="mock-mixer"]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid="mock-strip"]')).not.toBeNull();
  });
});
