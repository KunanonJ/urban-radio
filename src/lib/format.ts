export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDurationLong(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

/** Wall-clock time when playback will reach a queue position (seconds from now). */
export function formatStartsAtClock(secondsFromNow: number): string {
  const d = new Date(Date.now() + Math.max(0, secondsFromNow) * 1000);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Human-readable delay until a track starts (e.g. "in 3:24"). */
export function formatStartsIn(secondsFromNow: number): string {
  const s = Math.max(0, Math.floor(secondsFromNow));
  if (s < 3600) return `in ${formatDuration(s)}`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `in ${h}h ${m}m`;
}

/** H:MM:SS or M:SS for queue totals. */
export function formatHMS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
