import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// ─── module mocks ──────────────────────────────────────────────────────────

// Mock i18n — return human-readable strings so we can assert.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { usd?: string }) => {
      const map: Record<string, string> = {
        'voiceTracks.aiDrawer.title': 'AI voice track',
        'voiceTracks.aiDrawer.voiceLabel': 'Voice',
        'voiceTracks.aiDrawer.voiceScope.cloned': 'Cloned voices',
        'voiceTracks.aiDrawer.voiceScope.stock': 'Stock voices',
        'voiceTracks.aiDrawer.voiceScope.all': 'All',
        'voiceTracks.aiDrawer.topicLabel': 'Content topic',
        'voiceTracks.aiDrawer.topic.frontsell': 'Frontsell',
        'voiceTracks.aiDrawer.topic.backsell': 'Backsell',
        'voiceTracks.aiDrawer.topic.fun_fact': 'Fun fact',
        'voiceTracks.aiDrawer.topic.station_id': 'Station ID',
        'voiceTracks.aiDrawer.topic.weather': 'Weather',
        'voiceTracks.aiDrawer.topic.news': 'News',
        'voiceTracks.aiDrawer.topic.custom': 'Custom',
        'voiceTracks.aiDrawer.toneLabel': 'Tone',
        'voiceTracks.aiDrawer.tone.energetic': 'Energetic',
        'voiceTracks.aiDrawer.tone.calm': 'Calm',
        'voiceTracks.aiDrawer.tone.professional': 'Professional',
        'voiceTracks.aiDrawer.tone.cheeky': 'Cheeky',
        'voiceTracks.aiDrawer.tone.morning': 'Morning',
        'voiceTracks.aiDrawer.customPromptLabel': 'Custom prompt',
        'voiceTracks.aiDrawer.generateText': 'Generate script',
        'voiceTracks.aiDrawer.generateVoice': 'Generate audio',
        'voiceTracks.aiDrawer.scriptPreview': 'Generated script',
        'voiceTracks.aiDrawer.audioPreview': 'Generated audio',
        'voiceTracks.aiDrawer.save': 'Save voice track',
        'voiceTracks.aiDrawer.capHit': 'Plan cap reached.',
      };
      if (key === 'voiceTracks.aiDrawer.costEstimate' && opts?.usd) {
        return `Est. cost: ${opts.usd}`;
      }
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// Stub Sheet — radix portals are flaky in jsdom + we just need open/closed
// visibility. When `open` is true, render children inline; otherwise nothing.
vi.mock('@/components/ui/sheet', () => {
  function Sheet({ open, children }: { open?: boolean; children: ReactNode }) {
    return open ? <div data-testid="sheet-shim">{children}</div> : null;
  }
  function passthrough({ children }: { children?: ReactNode }) {
    return <div>{children}</div>;
  }
  return {
    Sheet,
    SheetContent: passthrough,
    SheetHeader: passthrough,
    SheetFooter: passthrough,
    SheetTitle: passthrough,
    SheetDescription: passthrough,
    SheetTrigger: passthrough,
    SheetClose: passthrough,
    SheetPortal: passthrough,
    SheetOverlay: passthrough,
  };
});

// Stub Select — render a native select so we can fire `change` events directly.
// We walk `children` to find any descendant that has `data-field`, and forward
// it onto the underlying `<select>` so tests can target inputs by purpose.
vi.mock('@/components/ui/select', () => {
  function findDataField(node: ReactNode): string | undefined {
    if (!node) return undefined;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findDataField(child);
        if (found) return found;
      }
      return undefined;
    }
    if (typeof node === 'object' && node !== null && 'props' in node) {
      const el = node as React.ReactElement<Record<string, unknown>>;
      const props = (el.props ?? {}) as Record<string, unknown>;
      const direct = props['data-field'];
      if (typeof direct === 'string') return direct;
      if ('children' in props) {
        return findDataField(props.children as ReactNode);
      }
    }
    return undefined;
  }

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children: ReactNode;
  }) {
    const dataField = findDataField(children);
    return (
      <select
        data-testid="select-shim"
        data-field={dataField}
        value={value ?? ''}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {children}
      </select>
    );
  }
  function SelectItem({ value, children }: { value: string; children: ReactNode }) {
    return <option value={value}>{children}</option>;
  }
  function SelectTrigger({
    children,
    ...rest
  }: {
    children?: ReactNode;
  } & Record<string, unknown>) {
    void rest;
    return <>{children}</>;
  }
  function passthrough({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  }
  return {
    Select,
    SelectItem,
    SelectTrigger,
    SelectContent: passthrough,
    SelectValue: passthrough,
    SelectGroup: passthrough,
    SelectLabel: passthrough,
    SelectSeparator: passthrough,
  };
});

// Stub Tabs — render all triggers + content inline, click sets active value.
vi.mock('@/components/ui/tabs', () => {
  function Tabs({
    value,
    defaultValue,
    onValueChange,
    children,
  }: {
    value?: string;
    defaultValue?: string;
    onValueChange?: (v: string) => void;
    children: ReactNode;
  }) {
    // Provide a context-like behavior via data attributes — but for tests we
    // just render children and rely on the TabsTrigger calling onValueChange.
    void value;
    void defaultValue;
    void onValueChange;
    return <div data-testid="tabs-shim">{children}</div>;
  }
  function TabsList({ children }: { children?: ReactNode }) {
    return <div role="tablist">{children}</div>;
  }
  function TabsTrigger({
    value,
    children,
    onClick,
  }: {
    value: string;
    children?: ReactNode;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  }) {
    return (
      <button type="button" data-tab-value={value} onClick={onClick}>
        {children}
      </button>
    );
  }
  function TabsContent({ children }: { children?: ReactNode }) {
    return <div>{children}</div>;
  }
  return { Tabs, TabsList, TabsTrigger, TabsContent };
});

// Mock the AI query hooks.
const voiceListMock = vi.fn();
const generateTextMutateAsyncMock = vi.fn();
const generateVoiceMutateAsyncMock = vi.fn();
let generateTextIsPending = false;
let generateVoiceIsPending = false;

vi.mock('@/lib/ai-queries', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/ai-queries')>('@/lib/ai-queries');
  return {
    ...actual,
    useVoiceList: () => voiceListMock(),
    useGenerateText: () => ({
      mutateAsync: generateTextMutateAsyncMock,
      get isPending() {
        return generateTextIsPending;
      },
    }),
    useGenerateVoice: () => ({
      mutateAsync: generateVoiceMutateAsyncMock,
      get isPending() {
        return generateVoiceIsPending;
      },
    }),
  };
});

// Mock the voice-track-queries module — only used for QueryClient invalidation,
// which we stub to a no-op.
vi.mock('@/lib/voice-track-queries', () => ({}));

// Mock apiFetch for the POST /api/voice-tracks call.
const apiFetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/api-base', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

// Stub useQueryClient — we just need invalidateQueries to be a no-op so tests
// don't blow up when the drawer calls it after a successful save.
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query',
  );
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
    }),
  };
});

// HTMLMediaElement audio metadata: jsdom doesn't load audio. We patch the
// `duration` getter so the drawer's onLoadedMetadata can compute durationMs.
Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
  configurable: true,
  get() {
    return 3.42; // 3.42s → 3420ms after the drawer's rounding
  },
});

import { VoiceTrackAiDrawer } from './VoiceTrackAiDrawer';
import type { VoiceListItem } from '@/lib/ai-queries';
import { CapHitError } from '@/lib/ai-queries';

(globalThis as typeof globalThis & {
  React?: typeof React;
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── helpers ───────────────────────────────────────────────────────────────

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

function setVoiceList(voices: VoiceListItem[] | undefined, isLoading = false) {
  voiceListMock.mockReturnValue({
    data: voices ? { voices } : undefined,
    isLoading,
    isError: false,
  });
}

function findButtonByText(root: HTMLElement, text: string): HTMLButtonElement | null {
  const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
  return (
    buttons.find((b) => (b.textContent ?? '').trim().includes(text)) ?? null
  );
}

function clickButton(btn: HTMLButtonElement) {
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  voiceListMock.mockReset();
  generateTextMutateAsyncMock.mockReset();
  generateVoiceMutateAsyncMock.mockReset();
  apiFetchMock.mockReset();
  generateTextIsPending = false;
  generateVoiceIsPending = false;
});

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

// ─── tests ─────────────────────────────────────────────────────────────────

describe('VoiceTrackAiDrawer', () => {
  test('VoiceTrackAiDrawer > given closed > renders nothing', () => {
    setVoiceList([]);
    const r = render(
      <VoiceTrackAiDrawer open={false} onOpenChange={() => {}} />,
    );
    expect(document.querySelector('[data-testid="sheet-shim"]')).toBeNull();
    cleanup(r);
  });

  test('VoiceTrackAiDrawer > given open + voice list loaded > renders voice options', () => {
    setVoiceList([
      { id: 'v1', name: 'Mike (Cloned)', scope: 'cloned', language: 'en' },
      { id: 'v2', name: 'Stock Warm', scope: 'stock', language: 'en' },
    ]);

    const r = render(
      <VoiceTrackAiDrawer open onOpenChange={() => {}} />,
    );

    // Voice select should contain options for each voice.
    const voiceSelect = document.querySelector(
      'select[data-field="voice"]',
    ) as HTMLSelectElement | null;
    expect(voiceSelect).not.toBeNull();
    const options = Array.from(voiceSelect?.options ?? []).map((o) => o.value);
    expect(options).toContain('v1');
    expect(options).toContain('v2');
    cleanup(r);
  });

  test('VoiceTrackAiDrawer > given Generate script click > calls useGenerateText with selected topic', async () => {
    setVoiceList([
      { id: 'v1', name: 'Mike', scope: 'cloned' as const, language: 'en' },
    ]);
    generateTextMutateAsyncMock.mockResolvedValue({
      ok: true,
      data: { text: 'Hello listeners!' },
      provider: 'stub',
    });

    const r = render(
      <VoiceTrackAiDrawer open onOpenChange={() => {}} />,
    );

    // Change topic to "fun_fact" via the topic select.
    const topicSelect = document.querySelector(
      'select[data-field="topic"]',
    ) as HTMLSelectElement | null;
    expect(topicSelect).not.toBeNull();
    act(() => {
      if (topicSelect) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          'value',
        )?.set;
        setter?.call(topicSelect, 'fun_fact');
        topicSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    const btn = findButtonByText(r.container, 'Generate script');
    expect(btn).not.toBeNull();
    if (btn) clickButton(btn);

    // Allow mutateAsync promise resolution to flush.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(generateTextMutateAsyncMock).toHaveBeenCalledTimes(1);
    const call = generateTextMutateAsyncMock.mock.calls[0][0];
    expect(call.topic).toBe('fun_fact');
    cleanup(r);
  });

  test('VoiceTrackAiDrawer > given script generated > Generate audio button is enabled', async () => {
    setVoiceList([{ id: 'v1', name: 'Mike', scope: 'cloned' as const, language: 'en' }]);
    generateTextMutateAsyncMock.mockResolvedValue({
      ok: true,
      data: { text: 'Hello listeners!' },
      provider: 'stub',
    });

    const r = render(
      <VoiceTrackAiDrawer open onOpenChange={() => {}} />,
    );

    // Before generation, the audio button is disabled.
    const audioBefore = findButtonByText(r.container, 'Generate audio');
    expect(audioBefore?.disabled).toBe(true);

    const textBtn = findButtonByText(r.container, 'Generate script');
    if (textBtn) clickButton(textBtn);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const audioAfter = findButtonByText(r.container, 'Generate audio');
    expect(audioAfter?.disabled).toBe(false);
    cleanup(r);
  });

  test('VoiceTrackAiDrawer > given audio generated > Save button is enabled', async () => {
    setVoiceList([{ id: 'v1', name: 'Mike', scope: 'cloned' as const, language: 'en' }]);
    generateTextMutateAsyncMock.mockResolvedValue({
      ok: true,
      data: { text: 'Hello listeners!' },
      provider: 'stub',
    });
    generateVoiceMutateAsyncMock.mockResolvedValue({
      ok: true,
      data: { audioBase64: 'ZmFrZQ==' },
      provider: 'stub',
    });

    const r = render(
      <VoiceTrackAiDrawer open onOpenChange={() => {}} />,
    );

    // Step 1: generate script.
    const textBtn = findButtonByText(r.container, 'Generate script');
    if (textBtn) clickButton(textBtn);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Save should still be disabled (no audio yet).
    const saveBefore = findButtonByText(r.container, 'Save voice track');
    expect(saveBefore?.disabled).toBe(true);

    // Step 2: generate audio.
    const audioBtn = findButtonByText(r.container, 'Generate audio');
    if (audioBtn) clickButton(audioBtn);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Simulate the <audio> loadedmetadata event so the drawer can capture duration.
    const audioEl = r.container.querySelector(
      'audio[data-field="audio-preview"]',
    ) as HTMLAudioElement | null;
    expect(audioEl).not.toBeNull();
    if (audioEl) {
      act(() => {
        audioEl.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
      });
    }

    const saveAfter = findButtonByText(r.container, 'Save voice track');
    expect(saveAfter?.disabled).toBe(false);
    cleanup(r);
  });

  test('VoiceTrackAiDrawer > given CapHitError from generate > shows capHit message', async () => {
    setVoiceList([{ id: 'v1', name: 'Mike', scope: 'cloned' as const, language: 'en' }]);
    generateTextMutateAsyncMock.mockRejectedValue(
      new CapHitError('monthly_cap', 0),
    );

    const r = render(
      <VoiceTrackAiDrawer open onOpenChange={() => {}} />,
    );

    const textBtn = findButtonByText(r.container, 'Generate script');
    if (textBtn) clickButton(textBtn);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect((r.container.textContent ?? '').includes('Plan cap reached.')).toBe(
      true,
    );
    cleanup(r);
  });

  test('VoiceTrackAiDrawer > given Save success > calls onSaved with the created voice track', async () => {
    setVoiceList([{ id: 'v1', name: 'Mike', scope: 'cloned' as const, language: 'en' }]);
    generateTextMutateAsyncMock.mockResolvedValue({
      ok: true,
      data: { text: 'Hello listeners!' },
      provider: 'stub',
    });
    generateVoiceMutateAsyncMock.mockResolvedValue({
      ok: true,
      data: { audioBase64: 'ZmFrZQ==' },
      provider: 'stub',
    });
    const fakeVoiceTrack = {
      id: 'vt-1',
      stationId: 's1',
      recordedBy: null,
      storageKey: 'voice-tracks/s1/vt-1',
      durationMs: 3420,
      transcript: 'Hello listeners!',
      targetClockSlotId: null,
      status: 'draft',
      aiGenerated: 1,
      createdAt: '2026-05-13T00:00:00Z',
    };
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ voiceTrack: fakeVoiceTrack }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    const r = render(
      <VoiceTrackAiDrawer open onOpenChange={onOpenChange} onSaved={onSaved} />,
    );

    // Generate text.
    const textBtn = findButtonByText(r.container, 'Generate script');
    if (textBtn) clickButton(textBtn);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Generate audio.
    const audioBtn = findButtonByText(r.container, 'Generate audio');
    if (audioBtn) clickButton(audioBtn);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Fire loadedmetadata so durationMs is captured.
    const audioEl = r.container.querySelector(
      'audio[data-field="audio-preview"]',
    ) as HTMLAudioElement | null;
    if (audioEl) {
      act(() => {
        audioEl.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
      });
    }

    // Click Save.
    const saveBtn = findButtonByText(r.container, 'Save voice track');
    expect(saveBtn).not.toBeNull();
    if (saveBtn) clickButton(saveBtn);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/api/voice-tracks');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.audioBase64).toBe('ZmFrZQ==');
    expect(body.transcript).toBe('Hello listeners!');
    expect(body.status).toBe('draft');
    expect(body.aiGenerated).toBe(true);

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0][0]).toEqual(fakeVoiceTrack);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    cleanup(r);
  });

  test('VoiceTrackAiDrawer > given empty voice list > disables Generate audio (no voice to pick)', async () => {
    setVoiceList([]);
    generateTextMutateAsyncMock.mockResolvedValue({
      ok: true,
      data: { text: 'Hello listeners!' },
      provider: 'stub',
    });

    const r = render(
      <VoiceTrackAiDrawer open onOpenChange={() => {}} />,
    );

    const textBtn = findButtonByText(r.container, 'Generate script');
    if (textBtn) clickButton(textBtn);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Even after the script is generated, audio button should still be
    // disabled because there is no voice to pick.
    const audioBtn = findButtonByText(r.container, 'Generate audio');
    expect(audioBtn?.disabled).toBe(true);
    cleanup(r);
  });
});
