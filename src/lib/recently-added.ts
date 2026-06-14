import type { Album } from '@/lib/types';

export type RecentBucket = 'yesterday' | 'thisWeek' | 'thisMonth' | 'earlier';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** Calendar yesterday relative to `now`. */
function calendarYesterday(now: Date): Date {
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  y.setHours(0, 0, 0, 0);
  return y;
}

/** Start of week (Sunday 00:00 local), same as `Date` getDay() convention. */
function startOfCalendarWeek(now: Date): Date {
  const d = startOfDay(now);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d;
}

/**
 * Groups an added-at timestamp into UI buckets (local calendar), matching common “Recently added” patterns.
 */
export function bucketForDateAdded(date: Date, now: Date): RecentBucket {
  const effective = date.getTime() > now.getTime() ? new Date(now) : date;

  const startOfToday = startOfDay(now);
  const y = calendarYesterday(now);

  if (isSameCalendarDay(effective, y)) {
    return 'yesterday';
  }

  /** Same calendar day as `now` (including “added today”) — group with current week in the UI. */
  if (isSameCalendarDay(effective, now)) {
    return 'thisWeek';
  }

  const startOfWeek = startOfCalendarWeek(now);
  if (effective >= startOfWeek && effective < startOfToday) {
    return 'thisWeek';
  }

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  /** Same calendar month as `now`, but before the current week window (e.g. Apr 1–2 when week starts Apr 3). */
  if (effective >= startOfMonth && effective < startOfWeek) {
    return 'thisMonth';
  }

  return 'earlier';
}

export function parseAlbumDateAdded(album: Album): Date | null {
  if (!album.dateAdded) return null;
  const d = new Date(album.dateAdded);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Newest first within each bucket; buckets are fixed order. */
const BUCKET_ORDER: RecentBucket[] = ['yesterday', 'thisWeek', 'thisMonth', 'earlier'];

export function groupAlbumsByRecentBucket(
  albums: Album[],
  now: Date
): Record<RecentBucket, Album[]> {
  const groups: Record<RecentBucket, Album[]> = {
    yesterday: [],
    thisWeek: [],
    thisMonth: [],
    earlier: [],
  };

  for (const album of albums) {
    const parsed = parseAlbumDateAdded(album);
    if (!parsed) {
      groups.earlier.push(album);
      continue;
    }
    const b = bucketForDateAdded(parsed, now);
    groups[b].push(album);
  }

  const sortNewestFirst = (a: Album, b: Album) => {
    const ta = parseAlbumDateAdded(a)?.getTime() ?? 0;
    const tb = parseAlbumDateAdded(b)?.getTime() ?? 0;
    return tb - ta;
  };

  for (const key of BUCKET_ORDER) {
    groups[key].sort(sortNewestFirst);
  }

  return groups;
}

export function filterAlbumsByQuery(albums: Album[], query: string): Album[] {
  const q = query.trim().toLowerCase();
  if (!q) return albums;
  return albums.filter(
    (a) =>
      a.title.toLowerCase().includes(q) ||
      a.artist.toLowerCase().includes(q) ||
      a.genre.toLowerCase().includes(q)
  );
}
