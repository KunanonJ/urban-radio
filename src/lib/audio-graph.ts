/**
 * audio-graph.ts — Web Audio API wrapper for the Live Studio
 *
 * Builds a small audio routing graph used by the Live Studio mixer:
 *
 *   auto channel  →┐
 *   mic  channel  →┼→ masterGain → masterAnalyser → destination
 *   aux  channel  →┘                                  (MediaStreamAudioDestinationNode)
 *
 * Each channel is `source → channelGain → channelAnalyser → masterGain`.
 *
 * Notes:
 * - jsdom does not implement Web Audio. Tests inject an `AudioContextClass`
 *   mock via `createAudioGraph({ AudioContextClass })`. Default uses the
 *   global `AudioContext` (with `webkitAudioContext` fallback).
 * - readPeak() reads `getByteTimeDomainData` and returns a mono peak (0..1).
 *   A single analyser per channel is used for simplicity (v1). Both `left`
 *   and `right` return the same value; the meter component renders them as
 *   two bars for visual symmetry and future stereo support.
 */

export type ChannelId = 'auto' | 'mic' | 'aux';

export interface AudioGraphChannel {
  id: ChannelId;
  gainNode: GainNode;
  analyser: AnalyserNode;
  /** Set channel volume 0..1 (clamped). */
  setVolume: (v: number) => void;
  /** Mute / unmute. Unmuting restores the volume captured before muting. */
  mute: (on: boolean) => void;
  /**
   * Apply a ducking attenuation factor 0..1, multiplied with current volume.
   * Pass 1 to reset to full (un-ducked) gain.
   */
  duck: (gain: number) => void;
}

export interface AudioGraph {
  context: AudioContext;
  channels: Record<ChannelId, AudioGraphChannel>;
  masterGain: GainNode;
  masterAnalyser: AnalyserNode;
  destination: MediaStreamAudioDestinationNode;
  /** Hook an HTMLMediaElement (the player's <audio>) into 'auto' or 'aux'. */
  connectMediaElement: (el: HTMLMediaElement, channelId: 'auto' | 'aux') => void;
  /** Hook a microphone MediaStream into the 'mic' channel. */
  connectMicStream: (stream: MediaStream) => void;
  setMasterVolume: (v: number) => void;
  close: () => Promise<void>;
}

export interface CreateAudioGraphOptions {
  /** Inject an AudioContext constructor for testing. */
  AudioContextClass?: typeof AudioContext;
}

/** Clamp a number to the [0, 1] range. */
function clampUnit(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function resolveAudioContextClass(opts: CreateAudioGraphOptions): typeof AudioContext {
  if (opts.AudioContextClass) return opts.AudioContextClass;
  const w = globalThis as typeof globalThis & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) {
    throw new Error('AudioContext is not available in this environment');
  }
  return Ctor;
}

function buildChannel(
  ctx: AudioContext,
  id: ChannelId,
  master: GainNode,
): AudioGraphChannel {
  const gainNode = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  gainNode.connect(analyser);
  analyser.connect(master);

  // Each channel tracks its "user-intended" volume separately from the
  // applied gain so that mute() / duck() can restore the right value.
  let baseVolume = 1;
  let duckFactor = 1;
  let muted = false;

  const applyGain = () => {
    gainNode.gain.value = muted ? 0 : baseVolume * duckFactor;
  };

  applyGain();

  return {
    id,
    gainNode,
    analyser,
    setVolume(v: number) {
      baseVolume = clampUnit(v);
      applyGain();
    },
    mute(on: boolean) {
      muted = on;
      applyGain();
    },
    duck(gain: number) {
      duckFactor = clampUnit(gain);
      applyGain();
    },
  };
}

export function createAudioGraph(
  opts: CreateAudioGraphOptions = {},
): AudioGraph {
  const Ctor = resolveAudioContextClass(opts);
  const context = new Ctor();

  const masterGain = context.createGain();
  const masterAnalyser = context.createAnalyser();
  masterAnalyser.fftSize = 2048;
  const destination = context.createMediaStreamDestination();

  masterGain.connect(masterAnalyser);
  masterAnalyser.connect(destination);

  const channels: Record<ChannelId, AudioGraphChannel> = {
    auto: buildChannel(context, 'auto', masterGain),
    mic: buildChannel(context, 'mic', masterGain),
    aux: buildChannel(context, 'aux', masterGain),
  };

  // Track media sources per element so we don't connect the same element
  // twice (Web Audio throws when an element is already a source node).
  const mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

  let micSource: MediaStreamAudioSourceNode | null = null;

  return {
    context,
    channels,
    masterGain,
    masterAnalyser,
    destination,
    connectMediaElement(el, channelId) {
      let source = mediaSources.get(el);
      if (!source) {
        source = context.createMediaElementSource(el);
        mediaSources.set(el, source);
      }
      source.connect(channels[channelId].gainNode);
    },
    connectMicStream(stream) {
      if (micSource) {
        try {
          micSource.disconnect();
        } catch {
          // ignore — disconnect may fail if never connected.
        }
      }
      micSource = context.createMediaStreamSource(stream);
      micSource.connect(channels.mic.gainNode);
    },
    setMasterVolume(v) {
      masterGain.gain.value = clampUnit(v);
    },
    async close() {
      await context.close();
    },
  };
}

export interface PeakSample {
  left: number;
  right: number;
  peak: number;
}

/**
 * Read instantaneous L/R peak from an AnalyserNode (0..1 amplitude).
 *
 * Implementation uses `getByteTimeDomainData` (unsigned 8-bit, midpoint 128).
 * The amplitude of each sample is `|sample - 128| / 128`. We return the
 * maximum amplitude as a mono peak — `left`, `right`, and `peak` all share
 * the same value in v1. The meter component renders L + R independently.
 */
export function readPeak(analyser: AnalyserNode): PeakSample {
  const size = analyser.fftSize;
  const buf = new Uint8Array(size);
  analyser.getByteTimeDomainData(buf);

  let max = 0;
  for (let i = 0; i < size; i++) {
    const amp = Math.abs(buf[i] - 128) / 128;
    if (amp > max) max = amp;
  }

  return { left: max, right: max, peak: max };
}

/** Convert a 0..1 amplitude to dBFS. Returns -Infinity for 0. */
export function amplitudeToDb(a: number): number {
  if (a <= 0) return -Infinity;
  return 20 * Math.log10(a);
}

/**
 * Enumerate available microphone input devices.
 * Returns an empty array if `navigator.mediaDevices` is unavailable.
 */
export async function listMicDevices(): Promise<MediaDeviceInfo[]> {
  const nav = (globalThis as typeof globalThis & {
    navigator?: { mediaDevices?: { enumerateDevices?: () => Promise<MediaDeviceInfo[]> } };
  }).navigator;
  const enumerate = nav?.mediaDevices?.enumerateDevices;
  if (!enumerate) return [];
  const devices = await enumerate.call(nav.mediaDevices);
  return devices.filter((d) => d.kind === 'audioinput');
}
