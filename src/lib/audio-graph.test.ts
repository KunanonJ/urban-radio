import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  amplitudeToDb,
  createAudioGraph,
  listMicDevices,
  readPeak,
} from '@/lib/audio-graph';

/* ---------------------------------------------------------------------------
 * Mock AudioContext / AudioNode classes — jsdom has no Web Audio support.
 * ------------------------------------------------------------------------ */

interface MockConnection {
  from: MockAudioNode;
  to: MockAudioNode;
}

class MockAudioNode {
  public connections: MockConnection[] = [];
  public context: MockAudioContext;
  constructor(context: MockAudioContext) {
    this.context = context;
  }
  connect(target: MockAudioNode): MockAudioNode {
    const link = { from: this, to: target };
    this.connections.push(link);
    this.context._allConnections.push(link);
    return target;
  }
  disconnect() {
    this.connections = [];
  }
}

class MockGainNode extends MockAudioNode {
  public gain = { value: 1 };
}

class MockAnalyserNode extends MockAudioNode {
  public fftSize = 2048;
  /** Optional fixed byte buffer for readPeak tests. */
  public _byteData: Uint8Array | null = null;
  getByteTimeDomainData(target: Uint8Array) {
    if (this._byteData) {
      target.set(this._byteData.subarray(0, target.length));
    } else {
      // Silent: all samples at midpoint 128.
      target.fill(128);
    }
  }
}

class MockMediaStreamAudioDestinationNode extends MockAudioNode {
  public stream = {} as MediaStream;
}

class MockMediaElementAudioSourceNode extends MockAudioNode {
  public mediaElement: HTMLMediaElement;
  constructor(context: MockAudioContext, el: HTMLMediaElement) {
    super(context);
    this.mediaElement = el;
  }
}

class MockMediaStreamAudioSourceNode extends MockAudioNode {
  public mediaStream: MediaStream;
  constructor(context: MockAudioContext, s: MediaStream) {
    super(context);
    this.mediaStream = s;
  }
}

class MockAudioContext {
  public _allConnections: MockConnection[] = [];
  public closed = false;
  createGain() {
    return new MockGainNode(this);
  }
  createAnalyser() {
    return new MockAnalyserNode(this);
  }
  createMediaStreamDestination() {
    return new MockMediaStreamAudioDestinationNode(this);
  }
  createMediaElementSource(el: HTMLMediaElement) {
    return new MockMediaElementAudioSourceNode(this, el);
  }
  createMediaStreamSource(s: MediaStream) {
    return new MockMediaStreamAudioSourceNode(this, s);
  }
  async close() {
    this.closed = true;
  }
}

// Cast the mock to the real type for createAudioGraph's option contract.
const MockAudioContextClass = MockAudioContext as unknown as typeof AudioContext;

/* ---------------------------------------------------------------------------
 * Tests
 * ------------------------------------------------------------------------ */

describe('createAudioGraph', () => {
  it('given mock AudioContext class > returns graph with 3 channels (auto/mic/aux)', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    expect(Object.keys(g.channels).sort()).toEqual(['auto', 'aux', 'mic']);
    expect(g.channels.auto.id).toBe('auto');
    expect(g.channels.mic.id).toBe('mic');
    expect(g.channels.aux.id).toBe('aux');
  });

  it('channels.auto.gainNode is wired to masterGain via analyser', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    const ctx = g.context as unknown as MockAudioContext;
    const masterGain = g.masterGain as unknown as MockGainNode;
    const autoGain = g.channels.auto.gainNode as unknown as MockGainNode;
    const autoAnalyser = g.channels.auto.analyser as unknown as MockAnalyserNode;

    // autoGain -> autoAnalyser
    expect(ctx._allConnections).toContainEqual(
      expect.objectContaining({ from: autoGain, to: autoAnalyser }),
    );
    // autoAnalyser -> masterGain
    expect(ctx._allConnections).toContainEqual(
      expect.objectContaining({ from: autoAnalyser, to: masterGain }),
    );
  });

  it('master chain wires masterGain → masterAnalyser → destination', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    const ctx = g.context as unknown as MockAudioContext;
    expect(ctx._allConnections).toContainEqual(
      expect.objectContaining({
        from: g.masterGain as unknown as MockGainNode,
        to: g.masterAnalyser as unknown as MockAnalyserNode,
      }),
    );
    expect(ctx._allConnections).toContainEqual(
      expect.objectContaining({
        from: g.masterAnalyser as unknown as MockAnalyserNode,
        to: g.destination as unknown as MockMediaStreamAudioDestinationNode,
      }),
    );
  });
});

describe('AudioGraphChannel.setVolume', () => {
  it('clamps below 0 to 0', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    g.channels.auto.setVolume(-1);
    expect((g.channels.auto.gainNode as unknown as MockGainNode).gain.value).toBe(0);
  });

  it('clamps above 1 to 1', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    g.channels.auto.setVolume(5);
    expect((g.channels.auto.gainNode as unknown as MockGainNode).gain.value).toBe(1);
  });

  it('passes through 0.5', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    g.channels.auto.setVolume(0.5);
    expect((g.channels.auto.gainNode as unknown as MockGainNode).gain.value).toBe(0.5);
  });
});

describe('AudioGraphChannel.mute', () => {
  it('mute(true) sets gain to 0', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    g.channels.auto.setVolume(0.7);
    g.channels.auto.mute(true);
    expect((g.channels.auto.gainNode as unknown as MockGainNode).gain.value).toBe(0);
  });

  it('mute(false) restores prior volume', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    g.channels.auto.setVolume(0.7);
    g.channels.auto.mute(true);
    g.channels.auto.mute(false);
    expect((g.channels.auto.gainNode as unknown as MockGainNode).gain.value).toBe(0.7);
  });
});

describe('AudioGraphChannel.duck', () => {
  it('duck(0.3) scales channel gain by 0.3 of base volume', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    g.channels.auto.setVolume(1);
    g.channels.auto.duck(0.3);
    expect(
      (g.channels.auto.gainNode as unknown as MockGainNode).gain.value,
    ).toBeCloseTo(0.3, 5);
  });

  it('duck(1) restores base gain', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    g.channels.auto.setVolume(0.8);
    g.channels.auto.duck(0.2);
    g.channels.auto.duck(1);
    expect(
      (g.channels.auto.gainNode as unknown as MockGainNode).gain.value,
    ).toBeCloseTo(0.8, 5);
  });
});

describe('AudioGraph.setMasterVolume', () => {
  it('clamps and applies', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    g.setMasterVolume(0.4);
    expect((g.masterGain as unknown as MockGainNode).gain.value).toBe(0.4);
    g.setMasterVolume(2);
    expect((g.masterGain as unknown as MockGainNode).gain.value).toBe(1);
    g.setMasterVolume(-1);
    expect((g.masterGain as unknown as MockGainNode).gain.value).toBe(0);
  });
});

describe('AudioGraph.connectMediaElement', () => {
  it('routes media element to the requested channel', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    const el = {} as HTMLMediaElement;
    g.connectMediaElement(el, 'auto');
    const ctx = g.context as unknown as MockAudioContext;
    const autoGain = g.channels.auto.gainNode as unknown as MockGainNode;
    // One of the connections should have an end-point at autoGain coming from a media element source.
    expect(
      ctx._allConnections.some(
        (c) =>
          c.to === autoGain && c.from instanceof MockMediaElementAudioSourceNode,
      ),
    ).toBe(true);
  });

  it('reuses the same source when the same element is connected twice', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    const el = {} as HTMLMediaElement;
    g.connectMediaElement(el, 'auto');
    g.connectMediaElement(el, 'auto');
    const ctx = g.context as unknown as MockAudioContext;
    const sources = ctx._allConnections
      .map((c) => c.from)
      .filter((n) => n instanceof MockMediaElementAudioSourceNode);
    // Two connect() calls, but only one MediaElementSource instance.
    expect(new Set(sources).size).toBe(1);
  });
});

describe('AudioGraph.connectMicStream', () => {
  it('routes a microphone stream to the mic channel gain', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    const stream = {} as MediaStream;
    g.connectMicStream(stream);
    const ctx = g.context as unknown as MockAudioContext;
    const micGain = g.channels.mic.gainNode as unknown as MockGainNode;
    expect(
      ctx._allConnections.some(
        (c) =>
          c.to === micGain && c.from instanceof MockMediaStreamAudioSourceNode,
      ),
    ).toBe(true);
  });
});

describe('AudioGraph.close', () => {
  it('closes the underlying audio context', async () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    await g.close();
    expect((g.context as unknown as MockAudioContext).closed).toBe(true);
  });
});

describe('readPeak', () => {
  it('given silent buffer (all 128) > returns 0 left/right/peak', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    const sample = readPeak(g.channels.auto.analyser);
    expect(sample.left).toBe(0);
    expect(sample.right).toBe(0);
    expect(sample.peak).toBe(0);
  });

  it('given full-scale buffer (0 / 255 extremes) > returns ~1', () => {
    const g = createAudioGraph({ AudioContextClass: MockAudioContextClass });
    const analyser = g.channels.auto.analyser as unknown as MockAnalyserNode;
    const buf = new Uint8Array(analyser.fftSize);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 2 === 0 ? 255 : 0;
    analyser._byteData = buf;

    const sample = readPeak(g.channels.auto.analyser);
    // |0 - 128| / 128 = 1 and |255 - 128| / 128 ≈ 0.992 → peak is 1.
    expect(sample.peak).toBeCloseTo(1, 2);
    expect(sample.left).toBeCloseTo(1, 2);
    expect(sample.right).toBeCloseTo(1, 2);
  });
});

describe('amplitudeToDb', () => {
  it('given 1 > returns 0 dBFS', () => {
    expect(amplitudeToDb(1)).toBeCloseTo(0, 5);
  });

  it('given 0.5 > returns approx -6.02 dBFS', () => {
    expect(amplitudeToDb(0.5)).toBeCloseTo(-6.0206, 3);
  });

  it('given 0 > returns -Infinity', () => {
    expect(amplitudeToDb(0)).toBe(-Infinity);
  });
});

describe('listMicDevices', () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    // jsdom navigator has no mediaDevices by default — install a spy.
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it('given mocked navigator.mediaDevices > returns only audioinput devices', async () => {
    const enumerate = vi.fn(async (): Promise<MediaDeviceInfo[]> => [
      { deviceId: 'mic-1', kind: 'audioinput', label: 'USB Mic', groupId: 'a' } as MediaDeviceInfo,
      { deviceId: 'cam-1', kind: 'videoinput', label: 'Webcam', groupId: 'b' } as MediaDeviceInfo,
      { deviceId: 'spk-1', kind: 'audiooutput', label: 'Speaker', groupId: 'c' } as MediaDeviceInfo,
      { deviceId: 'mic-2', kind: 'audioinput', label: 'Internal Mic', groupId: 'd' } as MediaDeviceInfo,
    ]);

    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { enumerateDevices: enumerate } },
      configurable: true,
      writable: true,
    });

    const devices = await listMicDevices();
    expect(devices).toHaveLength(2);
    expect(devices.map((d) => d.deviceId)).toEqual(['mic-1', 'mic-2']);
  });

  it('given no mediaDevices > returns empty array', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });
    const devices = await listMicDevices();
    expect(devices).toEqual([]);
  });
});
