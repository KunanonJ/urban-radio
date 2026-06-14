import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Mixer } from '@/components/live/Mixer';
import type { AudioGraph, AudioGraphChannel, ChannelId } from '@/lib/audio-graph';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'liveStudio.mixer.title': 'Mixer',
        'liveStudio.mixer.auto': 'Auto',
        'liveStudio.mixer.mic': 'Mic',
        'liveStudio.mixer.aux': 'Aux',
        'liveStudio.mixer.stream': 'Stream',
        'liveStudio.mixer.master': 'Master',
        'liveStudio.mixer.muted': 'Muted',
        'liveStudio.mixer.armed': 'Armed',
        'liveStudio.mixer.ducked': 'Ducked',
        'liveStudio.mixer.selectMicDevice': 'Microphone input device',
        'liveStudio.mixer.permissionDenied':
          'Microphone permission denied. Use the browser address bar to grant access.',
        'liveStudio.mixer.noDevices': 'No input devices detected',
        'liveStudio.meters.title': 'Levels',
        'liveStudio.meters.left': 'L',
        'liveStudio.meters.right': 'R',
        'liveStudio.meters.peak': 'PK',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

/** Build a fake AudioGraphChannel with spy setters. */
function fakeChannel(id: ChannelId): AudioGraphChannel & {
  setVolume: ReturnType<typeof vi.fn>;
  mute: ReturnType<typeof vi.fn>;
  duck: ReturnType<typeof vi.fn>;
} {
  return {
    id,
    gainNode: {} as GainNode,
    analyser: {
      fftSize: 2048,
      getByteTimeDomainData: (buf: Uint8Array) => buf.fill(128),
    } as unknown as AnalyserNode,
    setVolume: vi.fn(),
    mute: vi.fn(),
    duck: vi.fn(),
  };
}

function fakeGraph(): AudioGraph & {
  channels: Record<
    ChannelId,
    ReturnType<typeof fakeChannel>
  >;
  setMasterVolume: ReturnType<typeof vi.fn>;
  connectMicStream: ReturnType<typeof vi.fn>;
} {
  const channels: Record<ChannelId, ReturnType<typeof fakeChannel>> = {
    auto: fakeChannel('auto'),
    mic: fakeChannel('mic'),
    aux: fakeChannel('aux'),
  };
  return {
    context: {} as AudioContext,
    channels,
    masterGain: {} as GainNode,
    masterAnalyser: {
      fftSize: 2048,
      getByteTimeDomainData: (buf: Uint8Array) => buf.fill(128),
    } as unknown as AnalyserNode,
    destination: {} as MediaStreamAudioDestinationNode,
    connectMediaElement: vi.fn(),
    connectMicStream: vi.fn(),
    setMasterVolume: vi.fn(),
    close: vi.fn(async () => {}),
  };
}

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function mount(element: React.ReactElement): Rendered {
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

const originalNavigator = globalThis.navigator;

function installNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  // No mediaDevices by default. Each test installs what it needs.
  installNavigator({});
});

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  installNavigator(originalNavigator);
  vi.restoreAllMocks();
});

describe('Mixer', () => {
  test('given null graph > renders 4 strips in disabled state', () => {
    const rendered = mount(<Mixer graph={null} />);
    const root = rendered.container.querySelector('[data-testid="mixer"]');
    expect(root).not.toBeNull();
    expect(rendered.container.querySelector('[data-testid="mixer-strip-auto"]')).not.toBeNull();
    expect(rendered.container.querySelector('[data-testid="mixer-strip-mic"]')).not.toBeNull();
    expect(rendered.container.querySelector('[data-testid="mixer-strip-aux"]')).not.toBeNull();
    expect(rendered.container.querySelector('[data-testid="mixer-strip-master"]')).not.toBeNull();

    // All sliders disabled.
    const sliders = rendered.container.querySelectorAll('input[type="range"]');
    expect(sliders).toHaveLength(4);
    for (const slider of Array.from(sliders) as HTMLInputElement[]) {
      expect(slider.disabled).toBe(true);
    }
    unmount(rendered);
  });

  test('given graph > renders mic device picker, populated from listMicDevices', async () => {
    const enumerate = vi.fn(async () => [
      { deviceId: 'm1', kind: 'audioinput', label: 'USB Mic', groupId: 'g1' } as MediaDeviceInfo,
      { deviceId: 'm2', kind: 'audioinput', label: 'Internal Mic', groupId: 'g2' } as MediaDeviceInfo,
    ]);
    installNavigator({ mediaDevices: { enumerateDevices: enumerate } });

    const graph = fakeGraph();
    const rendered = mount(<Mixer graph={graph} />);

    // Flush microtasks twice — listMicDevices is awaited inside an effect.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const picker = rendered.container.querySelector(
      '[data-testid="mixer-mic-device-picker"]',
    ) as HTMLSelectElement | null;
    expect(picker).not.toBeNull();
    const labels = Array.from(picker?.options ?? []).map((o) => o.value);
    expect(labels).toContain('m1');
    expect(labels).toContain('m2');
    unmount(rendered);
  });

  test('given volume slider change > calls graph.channels[id].setVolume', () => {
    const graph = fakeGraph();
    const rendered = mount(<Mixer graph={graph} />);
    const slider = rendered.container.querySelector(
      '[data-testid="mixer-volume-auto"]',
    ) as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.disabled).toBe(false);

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(slider, '0.42');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      // React reads from change too; dispatch both for safety.
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(graph.channels.auto.setVolume).toHaveBeenCalledTimes(1);
    expect(graph.channels.auto.setVolume).toHaveBeenCalledWith(0.42);
    unmount(rendered);
  });

  test('given mute toggle > calls graph.channels[id].mute(!current)', () => {
    const graph = fakeGraph();
    const rendered = mount(<Mixer graph={graph} />);
    const muteBtn = rendered.container.querySelector(
      '[data-testid="mixer-mute-mic"]',
    ) as HTMLButtonElement | null;
    expect(muteBtn).not.toBeNull();
    expect(muteBtn?.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      muteBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(graph.channels.mic.mute).toHaveBeenCalledTimes(1);
    expect(graph.channels.mic.mute).toHaveBeenCalledWith(true);

    act(() => {
      muteBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(graph.channels.mic.mute).toHaveBeenCalledTimes(2);
    expect(graph.channels.mic.mute).toHaveBeenLastCalledWith(false);
    unmount(rendered);
  });

  test('given mediaDevices.getUserMedia error > calls onError with the error', async () => {
    const err = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const enumerate = vi.fn(async () => [
      { deviceId: 'm1', kind: 'audioinput', label: 'USB Mic', groupId: 'g1' } as MediaDeviceInfo,
    ]);
    const getUserMedia = vi.fn(async () => {
      throw err;
    });
    installNavigator({ mediaDevices: { enumerateDevices: enumerate, getUserMedia } });

    const onError = vi.fn();
    const graph = fakeGraph();
    const rendered = mount(<Mixer graph={graph} onError={onError} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const picker = rendered.container.querySelector(
      '[data-testid="mixer-mic-device-picker"]',
    ) as HTMLSelectElement;
    expect(picker).not.toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'value',
      )?.set;
      setter?.call(picker, 'm1');
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      // wait for the async handler
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe(err);

    // permission-denied banner shows
    expect(
      rendered.container.querySelector('[data-testid="mixer-permission-denied"]'),
    ).not.toBeNull();

    unmount(rendered);
  });
});
