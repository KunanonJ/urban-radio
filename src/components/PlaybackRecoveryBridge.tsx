import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { usePlayerStore } from '@/lib/store';
import {
  loadPlaybackSnapshot,
  savePlaybackSnapshot,
  getAutoResumePreference,
} from '@/lib/playback-persist';
import { resolveTrackById } from '@/lib/resolve-track';

/** Survives React Strict Mode double-mount so we hydrate snapshot only once. */
let snapshotHydrationRan = false;

/**
 * Session restore (localStorage), periodic snapshot, and toasts for connection recovery.
 * Does not render UI.
 */
export function PlaybackRecoveryBridge() {
  const { t } = useTranslation();
  const playbackConnectionState = usePlayerStore((s) => s.playbackConnectionState);
  const prevConnRef = useRef(playbackConnectionState);
  useEffect(() => {
    const prev = prevConnRef.current;
    if (prev === playbackConnectionState) return;
    prevConnRef.current = playbackConnectionState;

    if (playbackConnectionState === 'offline') {
      toast.warning(t('playback.recovery.offline'));
    } else if (playbackConnectionState === 'recovering') {
      toast.info(t('playback.recovery.recovering'));
    } else if (playbackConnectionState === 'failed') {
      toast.error(t('playback.recovery.failed'));
    } else if (playbackConnectionState === 'ok' && (prev === 'recovering' || prev === 'offline')) {
      toast.success(t('playback.recovery.backOnline'));
    }
  }, [playbackConnectionState, t]);

  useEffect(() => {
    if (snapshotHydrationRan) return;
    snapshotHydrationRan = true;

    const autoResume = getAutoResumePreference();
    usePlayerStore.setState({ autoResumePlayback: autoResume });

    const snap = loadPlaybackSnapshot();
    if (!snap) return;

    const tracks = snap.queueTrackIds
      .map((id) => resolveTrackById(id))
      .filter((tr): tr is NonNullable<typeof tr> => tr != null);
    if (tracks.length === 0) return;

    const idx = Math.min(snap.queueIndex, tracks.length - 1);
    const curId = snap.currentTrackId ?? tracks[idx]?.id;
    const curTrack = tracks.find((tr) => tr.id === curId) ?? tracks[idx];
    if (!curTrack) return;

    const qIdx = Math.max(0, tracks.findIndex((tr) => tr.id === curTrack.id));
    usePlayerStore.setState({
      queue: tracks,
      queueIndex: qIdx >= 0 ? qIdx : idx,
      currentTrack: curTrack,
      progress: snap.progress,
      isPlaying: false,
      currentTrackStartedAtMs: Date.now(),
      playbackConnectionState: 'ok',
    });

    if (autoResume && snap.wasPlaying && curTrack.mediaUrl) {
      toast.info(t('playback.recovery.resumeFromSession'));
      queueMicrotask(() => {
        usePlayerStore.getState().play();
      });
    }
  }, [t]);

  useEffect(() => {
    const flush = () => {
      const s = usePlayerStore.getState();
      savePlaybackSnapshot({
        queue: s.queue,
        queueIndex: s.queueIndex,
        progress: s.progress,
        isPlaying: s.isPlaying,
        currentTrack: s.currentTrack,
      });
    };

    const id = window.setInterval(flush, 2000);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);

  return null;
}
