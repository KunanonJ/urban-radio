import { describe, expect, it } from 'vitest';
import {
  computeNextOccurrences,
  getLocalMinuteKey,
  getMinutesSinceMidnight,
  isWithinDaypart,
  minuteMatchesRule,
  parseHHMM,
  shouldFireRuleAt,
  type SpotRule,
} from '@/lib/spot-schedule-engine';

const baseRule = (patch: Partial<SpotRule> = {}): SpotRule => ({
  id: 'r1',
  name: 'Test',
  enabled: true,
  minutesPastHour: [0, 30],
  trackIds: ['a'],
  insertMode: 'playNext',
  rotationIndex: 0,
  ...patch,
});

describe('spot-schedule-engine', () => {
  it('minuteMatchesRule', () => {
    const d = new Date(2026, 3, 4, 14, 30, 0);
    expect(minuteMatchesRule(d, [0, 30])).toBe(true);
    expect(minuteMatchesRule(d, [0])).toBe(false);
  });

  it('isWithinDaypart inclusive window', () => {
    const mid = new Date(2026, 3, 4, 12, 0, 0);
    expect(isWithinDaypart(mid, '06:00', '22:00')).toBe(true);
    const night = new Date(2026, 3, 4, 23, 0, 0);
    expect(isWithinDaypart(night, '06:00', '22:00')).toBe(false);
  });

  it('parseHHMM and getMinutesSinceMidnight', () => {
    expect(parseHHMM('06:30')).toBe(6 * 60 + 30);
    const d = new Date(2026, 3, 4, 9, 15, 0);
    expect(getMinutesSinceMidnight(d)).toBe(9 * 60 + 15);
  });

  it('shouldFireRuleAt dedupes same minute', () => {
    const d = new Date(2026, 3, 4, 10, 0, 5);
    const rule = baseRule();
    const key = getLocalMinuteKey(d);
    expect(shouldFireRuleAt(d, rule, undefined)).toBe(true);
    expect(shouldFireRuleAt(d, rule, key)).toBe(false);
  });

  it('shouldFireRuleAt disabled or empty tracks', () => {
    const d = new Date(2026, 3, 4, 10, 0, 0);
    expect(shouldFireRuleAt(d, baseRule({ enabled: false }), undefined)).toBe(false);
    expect(shouldFireRuleAt(d, baseRule({ trackIds: [] }), undefined)).toBe(false);
  });

  it('computeNextOccurrences finds :00 and :30', () => {
    const from = new Date(2026, 3, 4, 10, 5, 0);
    const rule = baseRule({ minutesPastHour: [0, 30] });
    const next = computeNextOccurrences(rule, from, 3);
    expect(next.length).toBe(3);
    expect(next[0].getHours()).toBe(10);
    expect(next[0].getMinutes()).toBe(30);
    expect(next[1].getMinutes()).toBe(0);
    expect(next[1].getHours()).toBe(11);
  });
});
