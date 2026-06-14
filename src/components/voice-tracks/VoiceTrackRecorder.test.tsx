import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { time?: string }) => {
      const map: Record<string, string> = {
        'voiceTracks.recorder.title': 'Record voice track',
        'voiceTracks.subtitle': 'Subtitle',
        'voiceTracks.recorder.armRecord': 'Arm recording',
        'voiceTracks.recorder.stop': 'Stop',
        'voiceTracks.recorder.save': 'Save',
        'voiceTracks.recorder.discard': 'Discard',
        'voiceTracks.recorder.saving': 'Saving…',
        'voiceTracks.recorder.permissionDenied': 'Mic permission denied',
        'voiceTracks.recorder.deviceLabel': 'Input device',
        'voiceTracks.recorder.noDevices': 'No input devices',
        'voiceTracks.recorder.audioPreview': 'Preview',
      };
      if (key === 'voiceTracks.recorder.elapsed') return `Elapsed: ${opts?.time ?? '0:00'}`;
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// Stub the dialog so jsdom doesn't have to deal with portals.
vi.mock('@/components/ui/dialog', () => {
  function Dialog({ open, children }: { open: boolean; children: ReactNode }) {
    return open ? <div data-testid="dialog-shim">{children}</div> : null;
  }
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
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

const createMutateMock = vi.fn();
let createIsPendingMock = false;

vi.mock('@/lib/voice-track-queries', () => ({
  useCreateVoiceTrack: () => ({
    mutate: createMutateMock,
    get isPending() {
      return createIsPendingMock;
    },
  }),
  VT_STATUS_VALUES: ['draft', 'ready', 'aired', 'archived'],
}));

import { VoiceTrackRecorder } from './VoiceTrackRecorder';

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

// ─── Global mocks for the Web Audio surface ─────────────────────────────────

const originalNavigator = globalThis.navigator;
const originalMediaRecorder = (globalThis as typeof globalThis & {
  MediaRecorder?: unknown;
}).MediaRecorder;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

interface FakeStreamShape extends MediaStream {
  getTracks: () => MediaStreamTrack[];
}

function makeFakeStream(): FakeStreamShape {
  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
  } as unknown as FakeStreamShape;
}

/**
 * Minimal MediaRecorder stand-in. Tests can drive it via the `instances`
 * registry exposed on the constructor.
 */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (_m: string) => true;
  mimeType: string;
  ondataavailable: ((e: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    // Real browsers fire dataavailable before stop; simulate that order.
    const ev = { data: new Blob(['fake-audio'], { type: this.mimeType }) } as BlobEvent;
    this.ondataavailable?.(ev);
    this.onstop?.();
  }
}

function installMockNavigator(opts: {
  getUserMediaImpl?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateImpl?: () => Promise<MediaDeviceInfo[]>;
}) {
  const fakeNav: {
    mediaDevices: {
      getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
      enumerateDevices: () => Promise<MediaDeviceInfo[]>;
    };
  } = {
    mediaDevices: {
      getUserMedia: opts.getUserMediaImpl ?? (async () => makeFakeStream()),
      enumerateDevices: opts.enumerateImpl ??
        (async () => [
          { deviceId: 'mic-1', kind: 'audioinput', label: 'Mic 1', groupId: 'g1' } as MediaDeviceInfo,
        ]),
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: fakeNav,
    configurable: true,
    writable: true,
  });
}

const rendered: Rendered[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  createIsPendingMock = false;
  FakeMediaRecorder.instances = [];
  installMockNavigator({});
  Object.defineProperty(globalThis, 'MediaRecorder', {
    value: FakeMediaRecorder,
    configurable: true,
    writable: true,
  });
  // jsdom doesn't implement these; install spies we can inspect.
  URL.createObjectURL = vi.fn(() => 'blob:fake-url');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) unmount(r);
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'MediaRecorder', {
    value: originalMediaRecorder,
    configurable: true,
    writable: true,
  });
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

async function flushAsync() {
  // listAudioInputDevices + getUserMedia both await promises before setState.
  // We need a couple of microtasks for state to settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('VoiceTrackRecorder', () => {
  test('given open=false > renders nothing (no dialog shim)', () => {
    const r = mount(
      <VoiceTrackRecorder open={false} onOpenChange={() => {}} />,
    );
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="dialog-shim"]')).toBeNull();
    expect(r.container.querySelector('[data-testid="vt-recorder-arm"]')).toBeNull();
  });

  test('given open + Arm click > calls getUserMedia and shows Stop button', async () => {
    const getUserMedia = vi.fn(async () => makeFakeStream());
    installMockNavigator({ getUserMediaImpl: getUserMedia });

    const r = mount(<VoiceTrackRecorder open={true} onOpenChange={() => {}} />);
    rendered.push(r);
    await flushAsync();

    const arm = r.container.querySelector(
      '[data-testid="vt-recorder-arm"]',
    ) as HTMLButtonElement;
    expect(arm).toBeTruthy();
    await act(async () => {
      arm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0].state).toBe('recording');
    expect(r.container.querySelector('[data-testid="vt-recorder-stop"]')).toBeTruthy();
    expect(r.container.querySelector('[data-testid="vt-recorder-arm"]')).toBeNull();
  });

  test('given Stop click after Arm > shows preview audio element', async () => {
    const r = mount(<VoiceTrackRecorder open={true} onOpenChange={() => {}} />);
    rendered.push(r);
    await flushAsync();

    await act(async () => {
      (r.container.querySelector('[data-testid="vt-recorder-arm"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(FakeMediaRecorder.instances).toHaveLength(1);

    await act(async () => {
      (r.container.querySelector('[data-testid="vt-recorder-stop"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(r.container.querySelector('[data-testid="vt-recorder-preview"]')).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  test('given Save with recorded blob > calls useCreateVoiceTrack.mutate with the blob', async () => {
    const onSaved = vi.fn();
    const r = mount(
      <VoiceTrackRecorder
        open={true}
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );
    rendered.push(r);
    await flushAsync();

    await act(async () => {
      (r.container.querySelector('[data-testid="vt-recorder-arm"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      (r.container.querySelector('[data-testid="vt-recorder-stop"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    const save = r.container.querySelector(
      '[data-testid="vt-recorder-save"]',
    ) as HTMLButtonElement;
    expect(save).toBeTruthy();
    expect(save.disabled).toBe(false);

    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(createMutateMock).toHaveBeenCalledTimes(1);
    const [input] = createMutateMock.mock.calls[0];
    expect(input.audioBlob).toBeInstanceOf(Blob);
    expect(input.meta).toMatchObject({ status: 'draft' });
    expect(typeof input.meta.durationMs).toBe('number');
  });

  test('given getUserMedia rejects > shows permissionDenied banner', async () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    installMockNavigator({
      getUserMediaImpl: vi.fn(async () => {
        throw err;
      }),
    });

    const r = mount(<VoiceTrackRecorder open={true} onOpenChange={() => {}} />);
    rendered.push(r);
    await flushAsync();

    await act(async () => {
      (r.container.querySelector('[data-testid="vt-recorder-arm"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      r.container.querySelector('[data-testid="vt-recorder-permission-denied"]'),
    ).toBeTruthy();
    // No MediaRecorder was constructed because we never got a stream.
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  test('given Discard after recording > revokes the preview URL and closes the dialog', async () => {
    const onOpenChange = vi.fn();
    const r = mount(
      <VoiceTrackRecorder open={true} onOpenChange={onOpenChange} />,
    );
    rendered.push(r);
    await flushAsync();

    await act(async () => {
      (r.container.querySelector('[data-testid="vt-recorder-arm"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      (r.container.querySelector('[data-testid="vt-recorder-stop"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    await act(async () => {
      (r.container.querySelector('[data-testid="vt-recorder-discard"]') as HTMLButtonElement)
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
