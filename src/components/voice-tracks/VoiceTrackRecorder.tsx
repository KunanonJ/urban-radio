'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useCreateVoiceTrack, type VoiceTrackRow } from '@/lib/voice-track-queries';

/**
 * Modal that captures audio from the user's mic via `MediaRecorder` and
 * uploads the result through `useCreateVoiceTrack`.
 *
 * The component intentionally only depends on the global `MediaRecorder` /
 * `navigator.mediaDevices` symbols and `URL.createObjectURL` — tests stub
 * those in jsdom (which has none of them natively).
 *
 * Lifecycle:
 *   1. Open the dialog → list audioinput devices.
 *   2. Click "Arm recording" → getUserMedia + start MediaRecorder.
 *   3. While recording → tick `elapsedMs` so the UI shows mm:ss.
 *   4. Click "Stop" → recorder.stop(), accumulate the final blob, build
 *      a preview URL.
 *   5. Click "Save" → invoke useCreateVoiceTrack, on success notify the
 *      parent and close.
 *   6. Click "Discard" or close the dialog → revoke the preview URL, stop
 *      any active tracks, and reset state.
 */
export interface VoiceTrackRecorderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (track: VoiceTrackRow) => void;
}

interface MediaDeviceInfoLite {
  deviceId: string;
  label: string;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Pick the most likely-supported audio MIME type so we don't hand the backend
 * something the browser can't actually record. Falls back to a plain string
 * when `MediaRecorder.isTypeSupported` doesn't exist (jsdom).
 */
function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  const MR = (globalThis as typeof globalThis & {
    MediaRecorder?: {
      isTypeSupported?: (mime: string) => boolean;
    };
  }).MediaRecorder;
  if (MR?.isTypeSupported) {
    for (const c of candidates) {
      try {
        if (MR.isTypeSupported(c)) return c;
      } catch {
        // continue
      }
    }
  }
  return 'audio/webm';
}

async function listAudioInputDevices(): Promise<MediaDeviceInfoLite[]> {
  const nav = (globalThis as typeof globalThis & {
    navigator?: {
      mediaDevices?: { enumerateDevices?: () => Promise<MediaDeviceInfo[]> };
    };
  }).navigator;
  const enumerate = nav?.mediaDevices?.enumerateDevices;
  if (!enumerate) return [];
  try {
    const all = await enumerate.call(nav!.mediaDevices);
    return all
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

export function VoiceTrackRecorder({
  open,
  onOpenChange,
  onSaved,
}: VoiceTrackRecorderProps) {
  const { t } = useTranslation();
  const create = useCreateVoiceTrack();

  const [devices, setDevices] = useState<MediaDeviceInfoLite[]>([]);
  const [deviceId, setDeviceId] = useState<string>('');
  const [recording, setRecording] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const durationMsRef = useRef<number>(0);

  const stopStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      try {
        for (const track of s.getTracks()) {
          try {
            track.stop();
          } catch {
            // ignore — track may already be stopped
          }
        }
      } catch {
        // ignore — best-effort cleanup
      }
    }
    streamRef.current = null;
  }, []);

  const clearTicker = useCallback(() => {
    if (tickerRef.current !== null) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  const revokePreview = useCallback(() => {
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch {
        // ignore
      }
    }
    setPreviewUrl(null);
  }, [previewUrl]);

  /** Reset to the "open + nothing recorded yet" state. */
  const reset = useCallback(() => {
    clearTicker();
    setRecording(false);
    setElapsedMs(0);
    setRecordedBlob(null);
    revokePreview();
    chunksRef.current = [];
    durationMsRef.current = 0;
    stopStream();
    recorderRef.current = null;
  }, [clearTicker, revokePreview, stopStream]);

  // Refresh the device list whenever we open the dialog. jsdom returns an
  // empty array, which is fine — the picker just disables.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listAudioInputDevices().then((list) => {
      if (cancelled) return;
      setDevices(list);
      // Default to the first device; tests can override.
      if (list.length > 0 && !deviceId) setDeviceId(list[0].deviceId);
    });
    return () => {
      cancelled = true;
    };
    // We intentionally don't depend on `deviceId` — only re-run when the
    // dialog transitions open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // When the dialog closes, fully tear everything down.
  useEffect(() => {
    if (open) return;
    reset();
    setPermissionDenied(false);
  }, [open, reset]);

  const startRecording = useCallback(async () => {
    setPermissionDenied(false);
    const nav = (globalThis as typeof globalThis & {
      navigator?: {
        mediaDevices?: {
          getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
        };
      };
    }).navigator;
    const getUserMedia = nav?.mediaDevices?.getUserMedia;
    if (!getUserMedia) {
      setPermissionDenied(true);
      return;
    }

    let stream: MediaStream;
    try {
      stream = await getUserMedia.call(nav!.mediaDevices, {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    } catch {
      // NotAllowedError, NotFoundError, etc. — surface the same banner.
      setPermissionDenied(true);
      return;
    }

    streamRef.current = stream;

    const MR = (globalThis as typeof globalThis & {
      MediaRecorder?: new (s: MediaStream, opts?: { mimeType?: string }) => MediaRecorder;
    }).MediaRecorder;
    if (!MR) {
      setPermissionDenied(true);
      stopStream();
      return;
    }

    const mimeType = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MR(stream, { mimeType });
    } catch {
      // Browser doesn't support our chosen MIME — fall back to default.
      rec = new MR(stream);
    }
    recorderRef.current = rec;
    chunksRef.current = [];

    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || mimeType });
      setRecordedBlob(blob);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      clearTicker();
      durationMsRef.current = Date.now() - startedAtRef.current;
      setRecording(false);
      stopStream();
    };

    startedAtRef.current = Date.now();
    durationMsRef.current = 0;
    setElapsedMs(0);
    rec.start();
    setRecording(true);
    tickerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 250);
  }, [deviceId, stopStream, clearTicker]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // ignore — already stopped
    }
  }, []);

  const handleSave = useCallback(() => {
    if (!recordedBlob) return;
    const durationMs = durationMsRef.current > 0 ? durationMsRef.current : elapsedMs;
    create.mutate(
      {
        audioBlob: recordedBlob,
        meta: { durationMs, status: 'draft' },
      },
      {
        onSuccess: ({ voiceTrack }) => {
          onSaved?.(voiceTrack);
          // Tear down + close.
          reset();
          onOpenChange(false);
        },
      },
    );
  }, [recordedBlob, elapsedMs, create, onSaved, onOpenChange, reset]);

  const handleDiscard = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [reset, onOpenChange]);

  // Stop any active recording on unmount. Without this a test that unmounts
  // mid-recording can leak a live MediaStream.
  useEffect(() => {
    return () => {
      clearTicker();
      stopStream();
    };
  }, [clearTicker, stopStream]);

  const elapsedLabel = useMemo(() => formatElapsed(elapsedMs), [elapsedMs]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="vt-recorder-dialog">
        <DialogHeader>
          <DialogTitle>{t('voiceTracks.recorder.title')}</DialogTitle>
          <DialogDescription>{t('voiceTracks.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="vt-recorder-device">
              {t('voiceTracks.recorder.deviceLabel')}
            </Label>
            <select
              id="vt-recorder-device"
              data-testid="vt-recorder-device-picker"
              value={deviceId}
              disabled={recording || devices.length === 0}
              onChange={(e) => setDeviceId(e.target.value)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {devices.length === 0 ? (
                <option value="">{t('voiceTracks.recorder.noDevices')}</option>
              ) : (
                devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId}
                  </option>
                ))
              )}
            </select>
          </div>

          {permissionDenied && (
            <p
              role="alert"
              data-testid="vt-recorder-permission-denied"
              className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {t('voiceTracks.recorder.permissionDenied')}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {!recording && !recordedBlob && (
              <Button
                type="button"
                data-testid="vt-recorder-arm"
                onClick={() => {
                  void startRecording();
                }}
              >
                <Mic className="mr-1 size-4" />
                {t('voiceTracks.recorder.armRecord')}
              </Button>
            )}

            {recording && (
              <Button
                type="button"
                variant="destructive"
                data-testid="vt-recorder-stop"
                onClick={stopRecording}
              >
                <Square className="mr-1 size-4" />
                {t('voiceTracks.recorder.stop')}
              </Button>
            )}

            <span
              data-testid="vt-recorder-elapsed"
              aria-live="polite"
              className="text-sm tabular-nums text-muted-foreground"
            >
              {t('voiceTracks.recorder.elapsed', { time: elapsedLabel })}
            </span>
          </div>

          {previewUrl && (
            <div className="space-y-1">
              <Label>{t('voiceTracks.recorder.audioPreview')}</Label>
              <audio
                data-testid="vt-recorder-preview"
                src={previewUrl}
                controls
                className="w-full"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            data-testid="vt-recorder-discard"
            onClick={handleDiscard}
          >
            {t('voiceTracks.recorder.discard')}
          </Button>
          <Button
            type="button"
            data-testid="vt-recorder-save"
            disabled={!recordedBlob || create.isPending}
            onClick={handleSave}
          >
            {create.isPending
              ? t('voiceTracks.recorder.saving')
              : t('voiceTracks.recorder.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default VoiceTrackRecorder;
