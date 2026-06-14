import type { Track } from '@/lib/types';

/** Seconds left in the current track + all tracks after the current index. */
export function getRemainingQueueSeconds(
  queue: Track[],
  queueIndex: number,
  progress: number,
  currentTrack: Track | null
): number {
  let sec = 0;
  if (currentTrack && currentTrack.duration > 0) {
    sec += currentTrack.duration * (1 - progress);
  }
  for (let i = queueIndex + 1; i < queue.length; i++) {
    sec += queue[i].duration;
  }
  return sec;
}
