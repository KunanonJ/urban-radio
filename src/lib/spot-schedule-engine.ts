import type { Weekday } from '@/lib/scheduler-store';

export type SpotInsertMode = 'playNext' | 'addToEnd';

export interface SpotRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Minutes past the hour (0–59), e.g. [0, 30] for top and half hour */
  minutesPastHour: number[];
  /** If omitted or empty, runs every day */
  daysOfWeek?: Weekday[];
  /** Optional daypart HH:MM (24h), local time */
  windowStart?: string;
  windowEnd?: string;
  trackIds: string[];
  insertMode: SpotInsertMode;
  /** Round-robin cursor for this rule’s pool */
  rotationIndex: number;
}

/** Stable key for “this clock minute” in local time. */
export function getLocalMinuteKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
}

export function parseHHMM(s: string | undefined): number | null {
  if (!s || !/^\d{2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function getMinutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Inclusive window [start, end] in minutes from midnight; supports overnight if start > end. */
export function isWithinDaypart(d: Date, windowStart?: string, windowEnd?: string): boolean {
  if (!windowStart && !windowEnd) return true;
  const start = parseHHMM(windowStart ?? '00:00');
  const end = parseHHMM(windowEnd ?? '23:59');
  if (start === null || end === null) return true;
  const now = getMinutesSinceMidnight(d);
  if (start <= end) {
    return now >= start && now <= end;
  }
  return now >= start || now <= end;
}

export function dayMatchesRule(d: Date, daysOfWeek?: Weekday[]): boolean {
  if (daysOfWeek == null || daysOfWeek.length === 0) return true;
  const dow = d.getDay() as Weekday;
  return daysOfWeek.includes(dow);
}

export function minuteMatchesRule(d: Date, minutesPastHour: number[]): boolean {
  const m = d.getMinutes();
  const set = new Set(minutesPastHour.map((x) => Math.min(59, Math.max(0, x))));
  return set.has(m);
}

export function shouldFireRuleAt(
  d: Date,
  rule: SpotRule,
  lastFiredMinuteKey: string | undefined
): boolean {
  if (!rule.enabled) return false;
  if (rule.trackIds.length === 0) return false;
  if (!dayMatchesRule(d, rule.daysOfWeek)) return false;
  if (!isWithinDaypart(d, rule.windowStart, rule.windowEnd)) return false;
  if (!minuteMatchesRule(d, rule.minutesPastHour)) return false;
  const key = getLocalMinuteKey(d);
  if (lastFiredMinuteKey === key) return false;
  return true;
}

/** Next N future firing times (minute resolution) from `from` (exclusive of past in same minute if needed). */
export function computeNextOccurrences(
  rule: SpotRule,
  from: Date,
  count: number,
  maxSteps = 10_080
): Date[] {
  const out: Date[] = [];
  if (count <= 0 || rule.trackIds.length === 0 || rule.minutesPastHour.length === 0) return out;

  const cur = new Date(from.getTime());
  cur.setSeconds(0, 0);
  let step = 0;

  while (out.length < count && step < maxSteps) {
    step += 1;
    cur.setMinutes(cur.getMinutes() + 1);

    if (!dayMatchesRule(cur, rule.daysOfWeek)) continue;
    if (!isWithinDaypart(cur, rule.windowStart, rule.windowEnd)) continue;
    if (!minuteMatchesRule(cur, rule.minutesPastHour)) continue;

    out.push(new Date(cur.getTime()));
  }

  return out;
}
