import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const map: Record<string, string> = {
        'liveStudio.quickVT.title': 'Quick voice track',
        'voiceTracks.newRecord': 'Record',
        'voiceTracks.newAi': 'AI generate',
      };
      if (key in map) return map[key];
      if (options && typeof options.defaultValue === 'string') return options.defaultValue;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

import { QuickVTPanel } from './QuickVTPanel';

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

async function flush() {
  // Give the inline fetch effect a tick to resolve.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderAsync(element: React.ReactElement): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  await flush();
  return { container, root };
}

function cleanup({ container, root }: Rendered) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

const rendered: Rendered[] = [];

interface FetchMock {
  fn: ReturnType<typeof vi.fn>;
}

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  reject?: Error;
}): FetchMock {
  const fn = vi.fn(async () => {
    if (response.reject) throw response.reject;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body ?? { voiceTracks: [] },
    } as Response;
  });
  (globalThis as typeof globalThis & { fetch?: typeof fetch }).fetch =
    fn as unknown as typeof fetch;
  return { fn };
}

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('QuickVTPanel', () => {
  test('given API returns no VTs > shows empty hint', async () => {
    mockFetch({ body: { voiceTracks: [], meta: { nextCursor: null, limit: 3 } } });

    const r = await renderAsync(<QuickVTPanel />);
    rendered.push(r);

    const text = r.container.textContent ?? '';
    expect(text).toContain('Quick voice track');
    expect(text).toContain('No ready voice tracks. Record one or generate with AI.');
  });

  test('given API returns 2 ready VTs > renders both', async () => {
    mockFetch({
      body: {
        voiceTracks: [
          {
            id: 'vt-1',
            stationId: 's',
            recordedBy: null,
            storageKey: 'k1',
            durationMs: 12_000,
            transcript: 'Top of the hour intro',
            targetClockSlotId: null,
            status: 'ready',
            aiGenerated: 0,
            createdAt: '2026-05-13T12:00:00Z',
          },
          {
            id: 'vt-2',
            stationId: 's',
            recordedBy: null,
            storageKey: 'k2',
            durationMs: 6_500,
            transcript: 'Backsell\nnotes',
            targetClockSlotId: null,
            status: 'ready',
            aiGenerated: 1,
            createdAt: '2026-05-13T12:01:00Z',
          },
        ],
        meta: { nextCursor: null, limit: 3 },
      },
    });

    const r = await renderAsync(<QuickVTPanel />);
    rendered.push(r);

    const items = r.container.querySelectorAll('[data-testid^="quick-vt-item-"]');
    expect(items.length).toBe(2);
    const text = r.container.textContent ?? '';
    expect(text).toContain('Top of the hour intro');
    // Only the first line of the transcript should be used as the title.
    expect(text).toContain('Backsell');
    // Durations: 12_000 ms => 0:12, 6_500 ms => 0:06
    expect(text).toContain('0:12');
    expect(text).toContain('0:06');
  });

  test('given Record click > dispatches open-vt-recorder event', async () => {
    mockFetch({ body: { voiceTracks: [], meta: { nextCursor: null, limit: 3 } } });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const r = await renderAsync(<QuickVTPanel />);
    rendered.push(r);

    const recordBtn = r.container.querySelector(
      '[data-testid="quick-vt-record"]',
    ) as HTMLButtonElement | null;
    expect(recordBtn).not.toBeNull();
    expect(recordBtn?.disabled).toBeFalsy();

    act(() => {
      recordBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const recorderCall = dispatchSpy.mock.calls.find(
      ([ev]) => ev instanceof CustomEvent && ev.type === 'open-vt-recorder',
    );
    expect(recorderCall).toBeDefined();
  });

  test('given AI generate click > dispatches open-vt-ai-drawer event', async () => {
    mockFetch({ body: { voiceTracks: [], meta: { nextCursor: null, limit: 3 } } });
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    const r = await renderAsync(<QuickVTPanel />);
    rendered.push(r);

    const aiBtn = r.container.querySelector(
      '[data-testid="quick-vt-ai"]',
    ) as HTMLButtonElement | null;
    expect(aiBtn).not.toBeNull();
    expect(aiBtn?.disabled).toBeFalsy();

    act(() => {
      aiBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const aiCall = dispatchSpy.mock.calls.find(
      ([ev]) => ev instanceof CustomEvent && ev.type === 'open-vt-ai-drawer',
    );
    expect(aiCall).toBeDefined();
  });

  test('given API errors > shows fallback (empty hint, not crash)', async () => {
    mockFetch({ reject: new Error('network down') });

    const r = await renderAsync(<QuickVTPanel />);
    rendered.push(r);

    const text = r.container.textContent ?? '';
    expect(text).toContain('Quick voice track');
    expect(text).toContain('No ready voice tracks. Record one or generate with AI.');
    // No item rows should render.
    expect(
      r.container.querySelectorAll('[data-testid^="quick-vt-item-"]').length,
    ).toBe(0);
  });

  test('renders title header and both action buttons', async () => {
    mockFetch({ body: { voiceTracks: [], meta: { nextCursor: null, limit: 3 } } });

    const r = await renderAsync(<QuickVTPanel />);
    rendered.push(r);

    const recordBtn = r.container.querySelector('[data-testid="quick-vt-record"]');
    const aiBtn = r.container.querySelector('[data-testid="quick-vt-ai"]');
    expect(recordBtn).not.toBeNull();
    expect(aiBtn).not.toBeNull();
    expect((recordBtn?.textContent ?? '').trim()).toBe('Record');
    expect((aiBtn?.textContent ?? '').trim()).toBe('AI generate');
  });

  test('caps rendered VTs at 3 even if API returns more', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `vt-${i}`,
      stationId: 's',
      recordedBy: null,
      storageKey: `k${i}`,
      durationMs: 10_000,
      transcript: `Track ${i}`,
      targetClockSlotId: null,
      status: 'ready',
      aiGenerated: 0,
      createdAt: `2026-05-13T12:0${i}:00Z`,
    }));
    mockFetch({ body: { voiceTracks: many, meta: { nextCursor: null, limit: 3 } } });

    const r = await renderAsync(<QuickVTPanel />);
    rendered.push(r);

    const items = r.container.querySelectorAll('[data-testid^="quick-vt-item-"]');
    expect(items.length).toBe(3);
  });

  test('fetches /api/voice-tracks with status=ready and limit=3', async () => {
    const { fn } = mockFetch({
      body: { voiceTracks: [], meta: { nextCursor: null, limit: 3 } },
    });

    const r = await renderAsync(<QuickVTPanel />);
    rendered.push(r);

    expect(fn).toHaveBeenCalled();
    const url = String(fn.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('/api/voice-tracks');
    expect(url).toContain('status=ready');
    expect(url).toContain('limit=3');
  });
});
