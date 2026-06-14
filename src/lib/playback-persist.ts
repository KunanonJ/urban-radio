import type { Track } from '@/lib/types';

const STORAGE_KEY = 'sonic-bloom-playback-snapshot';
const AUTO_RESUME_KEY = 'sonic-bloom-auto-resume-playback';

export type PlaybackSnapshotV1 = {
  v: 1;
  queueTrackIds: string[];
  queueIndex: number;
  progress: number;
  wasPlaying: boolean;
  currentTrackId: string | null;
  savedAt: number;
};

export function getAutoResumePreference(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_RESUME_KEY);
    if (raw === null) return true;
    return raw === '1' || raw === 'true';
  } catch {
    return true;
  }
}

export function setAutoResumePreference(value: boolean): void {
  try {
    localStorage.setItem(AUTO_RESUME_KEY, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function savePlaybackSnapshot(input: {
  queue: Track[];
  queueIndex: number;
  progress: number;
  isPlaying: boolean;
  currentTrack: Track | null;
}): void {
  try {
    if (!input.currentTrack || input.queue.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const snap: PlaybackSnapshotV1 = {
      v: 1,
      queueTrackIds: input.queue.map((t) => t.id),
      queueIndex: Math.min(input.queueIndex, input.queue.length - 1),
      progress: Math.min(1, Math.max(0, input.progress)),
      wasPlaying: input.isPlaying,
      currentTrackId: input.currentTrack.id,
      savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* quota / private mode */
  }
}

export function loadPlaybackSnapshot(): PlaybackSnapshotV1 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlaybackSnapshotV1;
    if (parsed.v !== 1 || !Array.isArray(parsed.queueTrackIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPlaybackSnapshot(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
