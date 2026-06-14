'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePlayerStore } from '@/lib/store';
import { MAX_RECOVERY_ATTEMPTS, recoveryBackoffMs } from '@/lib/playback-recovery';

/**
 * Real `<audio>` when `currentTrack.mediaUrl` exists; otherwise advances progress
 * in-memory from duration. Optional **crossfade** when both current and next
 * have `mediaUrl`, crossfade is enabled, shuffle is off, repeat is not `one`.
 *
 * When the network drops or the media element errors, reloads the source with
 * exponential backoff and resumes from the last known progress (see store).
 */
export function PlaybackEngine() {
  const primaryRef = useRef<HTMLAudioElement | null>(null);
  const secondaryRef = useRef<HTMLAudioElement | null>(null);
  const crossfadeActiveRef = useRef(false);
  const crossfadeStartedRef = useRef(false);
  const secondaryNextIdRef = useRef<string | null>(null);
  const suppressPrimaryLoadRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const crossfadeStartWallRef = useRef<number>(0);

  const recoveryAttemptsRef = useRef(0);
  const recoveryTimerRef = useRef<number | null>(null);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const progress = usePlayerStore((s) => s.progress);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const crossfadeEnabled = usePlayerStore((s) => s.crossfadeEnabled);
  const crossfadeDurationSec = usePlayerStore((s) => s.crossfadeDurationSec);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const syncProgress = usePlayerStore((s) => s.syncProgress);
  const handleTrackEnded = usePlayerStore((s) => s.handleTrackEnded);
  const advanceAfterCurrentTrackEnd = usePlayerStore((s) => s.advanceAfterCurrentTrackEnd);
  const getNextTrack = usePlayerStore((s) => s.getNextTrack);

  const mediaUrl = currentTrack?.mediaUrl ?? null;
  const durationSec = currentTrack?.duration ?? 0;

  const effectiveVol = isMuted ? 0 : volume;
  const effectiveVolRef = useRef(effectiveVol);
  effectiveVolRef.current = effectiveVol;

  const clearRecoveryTimer = useCallback(() => {
    if (recoveryTimerRef.current != null) {
      window.clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, []);

  const cancelCrossfade = useCallback(() => {
    crossfadeActiveRef.current = false;
    crossfadeStartedRef.current = false;
    secondaryNextIdRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const sec = secondaryRef.current;
    if (sec) {
      sec.pause();
      sec.removeAttribute('src');
      sec.load();
    }
    const pri = primaryRef.current;
    if (pri) pri.volume = effectiveVolRef.current;
  }, []);

  const executeRecoveryLoad = useCallback(() => {
    const el = primaryRef.current;
    if (!el) return;

    const st = usePlayerStore.getState();
    if (!st.isPlaying || !st.currentTrack?.mediaUrl) {
      recoveryAttemptsRef.current = 0;
      return;
    }

    if (recoveryAttemptsRef.current >= MAX_RECOVERY_ATTEMPTS) {
      st.setPlaybackConnectionState('failed');
      recoveryAttemptsRef.current = 0;
      return;
    }

    recoveryAttemptsRef.current += 1;
    st.setPlaybackConnectionState('recovering');

    const url = st.currentTrack.mediaUrl;
    const p = st.progress;
    const dur = st.currentTrack.duration || 0;

    cancelCrossfade();
    el.pause();
    el.src = url;
    el.load();

    const onMeta = () => {
      el.removeEventListener('loadedmetadata', onMeta);
      const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : dur;
      if (d > 0) {
        el.currentTime = Math.min(Math.max(0, p * d), Math.max(0, d - 0.05));
      }
      void el
        .play()
        .then(() => {
          recoveryAttemptsRef.current = 0;
          usePlayerStore.getState().setPlaybackConnectionState('ok');
        })
        .catch(() => {
          recoveryTimerRef.current = window.setTimeout(() => {
            executeRecoveryLoad();
          }, recoveryBackoffMs(recoveryAttemptsRef.current));
        });
    };
    el.addEventListener('loadedmetadata', onMeta);
  }, [cancelCrossfade]);

  const beginRecoveryFromError = useCallback(() => {
    clearRecoveryTimer();
    const st = usePlayerStore.getState();
    if (!st.isPlaying || !st.currentTrack?.mediaUrl) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      st.setPlaybackConnectionState('offline');
      return;
    }
    recoveryAttemptsRef.current = 0;
    recoveryTimerRef.current = window.setTimeout(() => {
      executeRecoveryLoad();
    }, 0);
  }, [clearRecoveryTimer, executeRecoveryLoad]);

  // Reset recovery when track / URL changes
  useEffect(() => {
    recoveryAttemptsRef.current = 0;
    clearRecoveryTimer();
  }, [mediaUrl, currentTrack?.id, clearRecoveryTimer]);

  // Window online / offline
  useEffect(() => {
    const onOnline = () => {
      recoveryAttemptsRef.current = 0;
      clearRecoveryTimer();
      const st = usePlayerStore.getState();
      if (st.isPlaying && st.currentTrack?.mediaUrl) {
        st.setPlaybackConnectionState('recovering');
        recoveryTimerRef.current = window.setTimeout(() => {
          executeRecoveryLoad();
        }, 0);
      } else {
        st.setPlaybackConnectionState('ok');
      }
    };
    const onOffline = () => {
      usePlayerStore.getState().setPlaybackConnectionState('offline');
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [clearRecoveryTimer, executeRecoveryLoad]);

  // Primary element: error + playing (success)
  useEffect(() => {
    const el = primaryRef.current;
    if (!el || !mediaUrl) return;

    const onError = () => {
      beginRecoveryFromError();
    };

    const onPlaying = () => {
      recoveryAttemptsRef.current = 0;
      clearRecoveryTimer();
      usePlayerStore.getState().setPlaybackConnectionState('ok');
    };

    el.addEventListener('error', onError);
    el.addEventListener('playing', onPlaying);
    return () => {
      el.removeEventListener('error', onError);
      el.removeEventListener('playing', onPlaying);
    };
  }, [mediaUrl, beginRecoveryFromError, clearRecoveryTimer]);

  // Volume on primary when not crossfading
  useEffect(() => {
    const el = primaryRef.current;
    if (!el) return;
    if (!crossfadeActiveRef.current) el.volume = effectiveVol;
  }, [volume, isMuted, effectiveVol]);

  // Load / change source (primary)
  useEffect(() => {
    const el = primaryRef.current;
    if (!el || !currentTrack || !mediaUrl) return;
    if (suppressPrimaryLoadRef.current) {
      return;
    }
    cancelCrossfade();
    el.src = mediaUrl;
    el.load();
  }, [currentTrack, mediaUrl, cancelCrossfade]);

  // Seek sync (user drag + store changes) — cancel crossfade on seek
  useEffect(() => {
    const el = primaryRef.current;
    if (!el || !mediaUrl || !currentTrack) return;
    if (crossfadeActiveRef.current) cancelCrossfade();
    const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : currentTrack.duration;
    if (!d) return;
    const target = progress * d;
    if (Number.isFinite(target) && Math.abs(el.currentTime - target) > 0.25) {
      el.currentTime = target;
    }
  }, [progress, currentTrack?.id, mediaUrl, currentTrack, cancelCrossfade]);

  // timeupdate + ended (primary)
  useEffect(() => {
    const el = primaryRef.current;
    if (!el || !mediaUrl || !currentTrack) return;

    const dur =
      Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationSec;
    if (!dur) return;

    const onTimeUpdate = () => {
      const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : durationSec;
      if (!d) return;
      syncProgress(el.currentTime / d);

      const next = getNextTrack();
      const canCf =
        crossfadeEnabled &&
        !shuffle &&
        repeat !== 'one' &&
        next?.mediaUrl &&
        currentTrack.mediaUrl &&
        d > crossfadeDurationSec + 0.5 &&
        !crossfadeStartedRef.current;

      const remaining = Math.max(0, d - el.currentTime);
      if (canCf && remaining <= crossfadeDurationSec + 0.05 && next) {
        crossfadeStartedRef.current = true;
        crossfadeActiveRef.current = true;
        secondaryNextIdRef.current = next.id;
        const sec = secondaryRef.current;
        if (sec) {
          sec.src = next.mediaUrl!;
          sec.load();
          crossfadeStartWallRef.current = performance.now();
          void sec.play().catch(() => {});
          sec.volume = 0;
          el.volume = effectiveVol;
          const fadeMs = crossfadeDurationSec * 1000;
          const step = () => {
            const secEl = secondaryRef.current;
            const priEl = primaryRef.current;
            if (!crossfadeActiveRef.current || !secEl || !priEl) return;
            const t = Math.min(1, (performance.now() - crossfadeStartWallRef.current) / fadeMs);
            priEl.volume = effectiveVol * (1 - t);
            secEl.volume = effectiveVol * t;
            if (t < 1) {
              rafRef.current = requestAnimationFrame(step);
            } else {
              rafRef.current = null;
            }
          };
          rafRef.current = requestAnimationFrame(step);
        }
      }
    };

    const onEnded = () => {
      const sec = secondaryRef.current;
      const next = getNextTrack();
      if (
        crossfadeActiveRef.current &&
        sec &&
        next?.mediaUrl &&
        secondaryNextIdRef.current === next.id &&
        currentTrack.mediaUrl
      ) {
        const frac = Math.min(1, sec.currentTime / Math.max(1, next.duration));
        suppressPrimaryLoadRef.current = true;
        advanceAfterCurrentTrackEnd(frac);
        queueMicrotask(() => {
          const p = primaryRef.current;
          const st = usePlayerStore.getState();
          const t = st.currentTrack;
          if (!p || !t?.mediaUrl || !sec) {
            suppressPrimaryLoadRef.current = false;
            cancelCrossfade();
            return;
          }
          const resumeAt = Math.min(sec.currentTime, Math.max(0, t.duration - 0.05));
          const onMeta = () => {
            p.currentTime = resumeAt;
            p.volume = effectiveVol;
            void p.play().catch(() => {});
            p.removeEventListener('loadedmetadata', onMeta);
            suppressPrimaryLoadRef.current = false;
          };
          p.addEventListener('loadedmetadata', onMeta);
          p.src = t.mediaUrl;
          p.load();
          sec.pause();
          sec.removeAttribute('src');
          sec.load();
          crossfadeActiveRef.current = false;
          crossfadeStartedRef.current = false;
          secondaryNextIdRef.current = null;
          if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
        });
        return;
      }
      cancelCrossfade();
      handleTrackEnded();
    };

    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ended', onEnded);
    };
  }, [
    mediaUrl,
    durationSec,
    syncProgress,
    handleTrackEnded,
    advanceAfterCurrentTrackEnd,
    getNextTrack,
    crossfadeEnabled,
    crossfadeDurationSec,
    repeat,
    shuffle,
    currentTrack,
    effectiveVol,
    cancelCrossfade,
  ]);

  // Play / pause primary
  useEffect(() => {
    const el = primaryRef.current;
    if (!el || !mediaUrl) return;
    if (isPlaying) {
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isPlaying, mediaUrl]);

  // Simulated progress (no media file)
  useEffect(() => {
    if (!currentTrack || mediaUrl || !durationSec || durationSec <= 0) return;
    if (!isPlaying) return;

    const tickMs = 100;
    const id = window.setInterval(() => {
      const { progress: p, currentTrack: t } = usePlayerStore.getState();
      if (!t || t.mediaUrl) return;
      const dur = t.duration;
      if (!dur) return;
      const step = tickMs / 1000 / dur;
      const np = Math.min(1, p + step);
      syncProgress(np);
      if (np >= 1) {
        handleTrackEnded();
      }
    }, tickMs);
    return () => clearInterval(id);
  }, [currentTrack, isPlaying, mediaUrl, durationSec, syncProgress, handleTrackEnded]);

  return (
    <>
      <audio
        ref={primaryRef}
        className="absolute h-0 w-0 opacity-0 pointer-events-none"
        playsInline
        preload="metadata"
        aria-hidden
      />
      <audio
        ref={secondaryRef}
        className="absolute h-0 w-0 opacity-0 pointer-events-none"
        playsInline
        preload="auto"
        aria-hidden
      />
    </>
  );
}
