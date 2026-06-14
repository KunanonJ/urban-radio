import type { Track } from '@/lib/types';
import type { SpotRule } from '@/lib/spot-schedule-engine';

export type SearchHit =
  | { kind: 'track'; track: Track; rank: number }
  | { kind: 'spot'; rule: SpotRule; rank: number };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Short schedule line for search matching and subtitles (English abbreviations). */
export function formatSpotRuleShort(rule: SpotRule): string {
  const parts: string[] = [];
  if (rule.minutesPastHour?.length) {
    const m = [...new Set(rule.minutesPastHour)].sort((a, b) => a - b);
    parts.push(m.map((x) => `${x}m`).join(', '));
  }
  if (rule.windowStart || rule.windowEnd) {
    parts.push(`${rule.windowStart ?? '00:00'}–${rule.windowEnd ?? '23:59'}`);
  }
  if (rule.daysOfWeek?.length) {
    parts.push(rule.daysOfWeek.map((d) => DOW[d]).join('·'));
  }
  return parts.join(' · ') || rule.name;
}

function rankTrack(q: string, tr: Track): number {
  const ql = q.toLowerCase();
  const title = tr.title.toLowerCase();
  const artist = tr.artist.toLowerCase();
  const album = tr.album.toLowerCase();
  if (title === ql) return 100;
  if (title.startsWith(ql)) return 85;
  if (artist === ql) return 82;
  if (title.includes(ql)) return 65;
  if (artist.startsWith(ql)) return 62;
  if (artist.includes(ql)) return 48;
  if (album.includes(ql)) return 35;
  return 0;
}

function rankSpot(q: string, rule: SpotRule): number {
  const ql = q.toLowerCase();
  const name = rule.name.toLowerCase();
  const hay = `${name} ${formatSpotRuleShort(rule)}`.toLowerCase();
  if (name === ql) return 100;
  if (name.startsWith(ql)) return 85;
  if (name.includes(ql)) return 65;
  if (hay.includes(ql)) return 42;
  return 0;
}

export function buildSearchHits(query: string, tracks: Track[], rules: SpotRule[]): SearchHit[] {
  const q = query.trim();
  if (!q) return [];

  const hits: SearchHit[] = [];
  for (const track of tracks) {
    const rank = rankTrack(q, track);
    if (rank > 0) hits.push({ kind: 'track', track, rank });
  }
  for (const rule of rules) {
    const rank = rankSpot(q, rule);
    if (rank > 0) hits.push({ kind: 'spot', rule, rank });
  }

  hits.sort((a, b) => {
    const d = b.rank - a.rank;
    if (d !== 0) return d;
    const ta = a.kind === 'track' ? a.track.title : a.rule.name;
    const tb = b.kind === 'track' ? b.track.title : b.rule.name;
    return ta.localeCompare(tb);
  });

  return hits;
}
