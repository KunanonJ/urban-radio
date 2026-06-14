import type { Track } from '@/lib/types';

/** Picks tracks in rotation order by `genre` bucket until `targetSeconds` is reached. */
export function generateRotationPlaylist(
  pool: Track[],
  rotation: string[],
  targetSeconds: number
): Track[] {
  if (rotation.length === 0 || pool.length === 0 || targetSeconds <= 0) return [];

  const byGenre = new Map<string, Track[]>();
  for (const t of pool) {
    const g = t.genre || 'Other';
    if (!byGenre.has(g)) byGenre.set(g, []);
    byGenre.get(g)!.push(t);
  }
  for (const list of byGenre.values()) {
    list.sort(() => Math.random() - 0.5);
  }

  const out: Track[] = [];
  let total = 0;
  let rot = 0;
  const used = new Set<string>();

  while (total < targetSeconds && out.length < pool.length * 8) {
    const bucket = rotation[rot % rotation.length];
    rot++;
    const genreList = byGenre.get(bucket);
    const pick =
      genreList?.find((t) => !used.has(t.id)) ?? pool.find((t) => !used.has(t.id));
    if (!pick) break;
    used.add(pick.id);
    out.push(pick);
    total += pick.duration;
  }

  return out;
}

export function uniqueGenres(tracks: Track[]): string[] {
  return [...new Set(tracks.map((t) => t.genre || 'Other'))].sort();
}

/**
 * Like `generateRotationPlaylist`, but inserts `breakTrack` after roughly every
 * `insertBreakEverySeconds` of accumulated music duration (excluding breaks).
 */
export function generateRotationPlaylistWithBreaks(
  pool: Track[],
  rotation: string[],
  targetSeconds: number,
  breakTrack: Track,
  insertBreakEverySeconds: number
): Track[] {
  if (insertBreakEverySeconds <= 0) {
    return generateRotationPlaylist(pool, rotation, targetSeconds);
  }
  const base = generateRotationPlaylist(pool, rotation, targetSeconds);
  const out: Track[] = [];
  let musicAccum = 0;
  for (const t of base) {
    out.push(t);
    musicAccum += t.duration;
    if (musicAccum >= insertBreakEverySeconds) {
      out.push({ ...breakTrack, id: `${breakTrack.id}-${out.length}` });
      musicAccum = 0;
    }
  }
  return out;
}
