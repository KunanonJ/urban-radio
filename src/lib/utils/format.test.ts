import { describe, it, expect } from 'vitest';
import { formatDuration, formatDurationLong, formatDateKey, parseDateKey, formatPercentage } from './format';

describe('formatDuration', () => {
  it('formats seconds to m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(30)).toBe('0:30');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration(3600)).toBe('60:00');
  });
});

describe('formatDurationLong', () => {
  it('formats small durations', () => {
    expect(formatDurationLong(45)).toBe('45s');
    expect(formatDurationLong(90)).toBe('1m 30s');
  });

  it('formats durations with hours', () => {
    expect(formatDurationLong(3661)).toBe('1h 1m 1s');
  });
});

describe('formatDateKey', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date(2026, 3, 5); // April 5, 2026
    expect(formatDateKey(date)).toBe('2026-04-05');
  });

  it('zero-pads month and day', () => {
    const date = new Date(2026, 0, 1); // Jan 1, 2026
    expect(formatDateKey(date)).toBe('2026-01-01');
  });
});

describe('parseDateKey', () => {
  it('parses YYYY-MM-DD to Date', () => {
    const date = parseDateKey('2026-04-05');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(3); // April = 3
    expect(date.getDate()).toBe(5);
  });
});

describe('formatPercentage', () => {
  it('calculates percentage', () => {
    expect(formatPercentage(50, 100)).toBe('50%');
    expect(formatPercentage(1, 3)).toBe('33%');
    expect(formatPercentage(0, 0)).toBe('0%');
    expect(formatPercentage(100, 100)).toBe('100%');
  });
});
