'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type AudioGraph,
  type ChannelId,
  listMicDevices,
} from '@/lib/audio-graph';
import { LevelMeter } from '@/components/live/LevelMeter';
import { cn } from '@/lib/utils';

export interface MixerProps {
  graph: AudioGraph | null;
  onError?: (err: Error) => void;
}

interface ChannelState {
  volume: number;
  muted: boolean;
}

const CHANNEL_IDS: ChannelId[] = ['auto', 'mic', 'aux'];

interface ChannelStripProps {
  id: ChannelId;
  label: string;
  state: ChannelState;
  analyser: AnalyserNode | null;
  disabled: boolean;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  /** When provided, the strip renders a device picker (used by 'mic'). */
  devicePicker?: React.ReactNode;
  mutedLabel: string;
}

function ChannelStrip({
  id,
  label,
  state,
  analyser,
  disabled,
  onVolume,
  onToggleMute,
  devicePicker,
  mutedLabel,
}: ChannelStripProps) {
  return (
    <div
      className={cn(
        'flex w-32 flex-col items-stretch gap-2 rounded-md border border-border bg-card p-3',
        disabled && 'opacity-60',
      )}
      data-testid={`mixer-strip-${id}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-foreground">
          {label}
        </span>
        {state.muted && (
          <span className="text-[9px] uppercase tracking-wide text-destructive">
            {mutedLabel}
          </span>
        )}
      </div>

      {devicePicker}

      <div className="flex flex-1 items-stretch gap-2">
        <LevelMeter
          analyser={state.muted ? null : analyser}
          label=""
          orientation="vertical"
        />
        <div className="flex flex-1 flex-col items-center justify-end gap-2">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={state.volume}
            disabled={disabled}
            onChange={(e) => onVolume(Number(e.target.value))}
            className="h-24 w-2 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            style={{ writingMode: 'vertical-lr' as React.CSSProperties['writingMode'] }}
            data-testid={`mixer-volume-${id}`}
            aria-label={`${label} volume`}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={onToggleMute}
        disabled={disabled}
        className={cn(
          'rounded-sm border px-2 py-1 text-xs',
          state.muted
            ? 'border-destructive bg-destructive/10 text-destructive'
            : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60',
        )}
        data-testid={`mixer-mute-${id}`}
        aria-pressed={state.muted}
      >
        M
      </button>
    </div>
  );
}

/**
 * Mixer — composes 4 channel strips (Auto / Mic / Aux / Master) plus a
 * microphone device picker. The mixer is fully driven by an `AudioGraph`
 * provided by its parent; when `graph === null`, the strips render in a
 * disabled state.
 *
 * The parent (LiveStudioPage) is expected to own the "enable audio" gate
 * (which is a user-gesture requirement for AudioContext).
 */
export function Mixer({ graph, onError }: MixerProps) {
  const { t } = useTranslation();

  const initial: ChannelState = { volume: 1, muted: false };
  const [auto, setAuto] = useState<ChannelState>(initial);
  const [mic, setMic] = useState<ChannelState>(initial);
  const [aux, setAux] = useState<ChannelState>(initial);
  const [master, setMaster] = useState<ChannelState>(initial);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [permissionDenied, setPermissionDenied] = useState(false);

  const disabled = graph === null;

  const channelStates: Record<ChannelId, ChannelState> = useMemo(
    () => ({ auto, mic, aux }),
    [auto, mic, aux],
  );

  const setChannelState: Record<ChannelId, (s: ChannelState) => void> = useMemo(
    () => ({ auto: setAuto, mic: setMic, aux: setAux }),
    [],
  );

  // Load mic devices once the graph is available.
  useEffect(() => {
    if (!graph) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listMicDevices();
        if (!cancelled) setDevices(list);
      } catch (err) {
        if (!cancelled) onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [graph, onError]);

  const handleVolume = useCallback(
    (id: ChannelId, v: number) => {
      setChannelState[id]({ ...channelStates[id], volume: v });
      graph?.channels[id].setVolume(v);
    },
    [channelStates, graph, setChannelState],
  );

  const handleMute = useCallback(
    (id: ChannelId) => {
      const next = !channelStates[id].muted;
      setChannelState[id]({ ...channelStates[id], muted: next });
      graph?.channels[id].mute(next);
    },
    [channelStates, graph, setChannelState],
  );

  const handleMasterVolume = useCallback(
    (v: number) => {
      setMaster((prev) => ({ ...prev, volume: v }));
      graph?.setMasterVolume(v);
    },
    [graph],
  );

  const handleMasterMute = useCallback(() => {
    setMaster((prev) => {
      const next = !prev.muted;
      graph?.setMasterVolume(next ? 0 : prev.volume);
      return { ...prev, muted: next };
    });
  }, [graph]);

  const handleDeviceChange = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      if (!graph) return;
      const nav = (globalThis as typeof globalThis & {
        navigator?: {
          mediaDevices?: {
            getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
          };
        };
      }).navigator;
      const getUserMedia = nav?.mediaDevices?.getUserMedia;
      if (!getUserMedia) {
        const err = new Error('mediaDevices.getUserMedia is not available');
        onError?.(err);
        return;
      }
      try {
        const stream = await getUserMedia.call(nav!.mediaDevices, {
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        });
        graph.connectMicStream(stream);
        setPermissionDenied(false);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.name === 'NotAllowedError' || /denied|permission/i.test(error.message)) {
          setPermissionDenied(true);
        }
        onError?.(error);
      }
    },
    [graph, onError],
  );

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4"
      data-testid="mixer"
      aria-label={t('liveStudio.mixer.title')}
    >
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
          {t('liveStudio.mixer.title')}
        </h2>
      </header>

      <div className="flex items-stretch gap-3">
        <ChannelStrip
          id="auto"
          label={t('liveStudio.mixer.auto')}
          state={auto}
          analyser={graph?.channels.auto.analyser ?? null}
          disabled={disabled}
          onVolume={(v) => handleVolume('auto', v)}
          onToggleMute={() => handleMute('auto')}
          mutedLabel={t('liveStudio.mixer.muted')}
        />

        <ChannelStrip
          id="mic"
          label={t('liveStudio.mixer.mic')}
          state={mic}
          analyser={graph?.channels.mic.analyser ?? null}
          disabled={disabled}
          onVolume={(v) => handleVolume('mic', v)}
          onToggleMute={() => handleMute('mic')}
          mutedLabel={t('liveStudio.mixer.muted')}
          devicePicker={
            <div className="flex flex-col gap-1">
              <label
                htmlFor="mixer-mic-device"
                className="text-[9px] uppercase tracking-wide text-muted-foreground"
              >
                {t('liveStudio.mixer.selectMicDevice')}
              </label>
              <select
                id="mixer-mic-device"
                value={selectedDeviceId}
                disabled={disabled}
                onChange={(e) => {
                  void handleDeviceChange(e.target.value);
                }}
                className="rounded-sm border border-border bg-background px-1 py-0.5 text-xs"
                data-testid="mixer-mic-device-picker"
              >
                {devices.length === 0 ? (
                  <option value="">{t('liveStudio.mixer.noDevices')}</option>
                ) : (
                  <>
                    <option value="">--</option>
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || d.deviceId}
                      </option>
                    ))}
                  </>
                )}
              </select>
              {permissionDenied && (
                <p
                  className="text-[10px] text-destructive"
                  data-testid="mixer-permission-denied"
                >
                  {t('liveStudio.mixer.permissionDenied')}
                </p>
              )}
            </div>
          }
        />

        <ChannelStrip
          id="aux"
          label={t('liveStudio.mixer.aux')}
          state={aux}
          analyser={graph?.channels.aux.analyser ?? null}
          disabled={disabled}
          onVolume={(v) => handleVolume('aux', v)}
          onToggleMute={() => handleMute('aux')}
          mutedLabel={t('liveStudio.mixer.muted')}
        />

        {/* Master strip — wider, with bigger meter (also vertical for now). */}
        <div
          className={cn(
            'flex w-40 flex-col items-stretch gap-2 rounded-md border border-border bg-card p-3',
            disabled && 'opacity-60',
          )}
          data-testid="mixer-strip-master"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
              {t('liveStudio.mixer.master')}
            </span>
            {master.muted && (
              <span className="text-[9px] uppercase tracking-wide text-destructive">
                {t('liveStudio.mixer.muted')}
              </span>
            )}
          </div>
          <div className="flex flex-1 items-stretch gap-2">
            <LevelMeter
              analyser={master.muted ? null : graph?.masterAnalyser ?? null}
              label=""
              orientation="vertical"
            />
            <div className="flex flex-1 flex-col items-center justify-end gap-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={master.volume}
                disabled={disabled}
                onChange={(e) => handleMasterVolume(Number(e.target.value))}
                className="h-24 w-2 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                style={{ writingMode: 'vertical-lr' as React.CSSProperties['writingMode'] }}
                data-testid="mixer-volume-master"
                aria-label="Master volume"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={handleMasterMute}
            disabled={disabled}
            className={cn(
              'rounded-sm border px-2 py-1 text-xs',
              master.muted
                ? 'border-destructive bg-destructive/10 text-destructive'
                : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60',
            )}
            data-testid="mixer-mute-master"
            aria-pressed={master.muted}
          >
            M
          </button>
        </div>
      </div>
    </section>
  );
}

// Note: CHANNEL_IDS is exported for tests / parent composition if needed.
export { CHANNEL_IDS };
