import { describe, test, expect } from 'vitest';
import {
  buildOverviewQuery,
  buildPlaysByDayQuery,
  buildTopTracksQuery,
  buildTopHoursQuery,
  buildSourceBreakdownQuery,
  clampLimit,
  REPORT_DEFAULT_TOP_LIMIT,
  REPORT_MAX_TOP_LIMIT,
} from './report-queries';

describe('clampLimit', () => {
  test('given undefined > returns default', () => {
    expect(clampLimit(undefined, 200, 25)).toBe(25);
  });

  test('given zero or negative > returns default', () => {
    expect(clampLimit(0, 200, 25)).toBe(25);
    expect(clampLimit(-1, 200, 25)).toBe(25);
  });

  test('given value above max > clamps to max', () => {
    expect(clampLimit(9999, 200, 25)).toBe(200);
    expect(clampLimit(201, 200, 25)).toBe(200);
  });

  test('given valid value > returns it (floored)', () => {
    expect(clampLimit(50, 200, 25)).toBe(50);
    expect(clampLimit(50.7, 200, 25)).toBe(50);
  });
});

describe('buildOverviewQuery', () => {
  test('scopes station_id as the first predicate', () => {
    const { sql, params } = buildOverviewQuery('urban-radio', {});
    expect(sql).toMatch(/FROM play_log/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
  });

  test('returns totalPlays + uniqueTitles + daysWithActivity + totalListeningHours columns', () => {
    const { sql } = buildOverviewQuery('s', {});
    expect(sql).toMatch(/COUNT\(\*\)\s+AS\s+totalPlays/);
    expect(sql).toMatch(/uniqueTitles/);
    expect(sql).toMatch(/daysWithActivity/);
    expect(sql).toMatch(/totalListeningHours/);
  });

  test('given date range > adds played_at filter', () => {
    const { sql, params } = buildOverviewQuery('s', {
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });
    expect(sql).toMatch(/played_at >= \?/);
    expect(sql).toMatch(/played_at < \?/);
    expect(params).toContain('2026-01-01T00:00:00Z');
    expect(params).toContain('2026-02-01T00:00:00Z');
  });

  test('given empty stationId > throws', () => {
    expect(() => buildOverviewQuery('', {})).toThrow();
  });
});

describe('buildPlaysByDayQuery', () => {
  test('scopes station_id', () => {
    const { sql, params } = buildPlaysByDayQuery('urban-radio', {});
    expect(sql).toMatch(/FROM play_log/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
  });

  test('GROUP BY day order ASC', () => {
    const { sql } = buildPlaysByDayQuery('s', {});
    expect(sql).toMatch(/strftime\('%Y-%m-%d', played_at\)/);
    expect(sql).toMatch(/GROUP BY day/);
    expect(sql).toMatch(/ORDER BY day ASC/);
  });

  test('given date range > adds played_at filter', () => {
    const { sql, params } = buildPlaysByDayQuery('s', {
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });
    expect(sql).toMatch(/played_at >= \?/);
    expect(sql).toMatch(/played_at < \?/);
    expect(params).toContain('2026-01-01T00:00:00Z');
    expect(params).toContain('2026-02-01T00:00:00Z');
  });

  test('given source filter > adds source = ?', () => {
    const { sql, params } = buildPlaysByDayQuery('s', {}, { source: 'automation' });
    expect(sql).toMatch(/source = \?/);
    expect(params).toContain('automation');
  });

  test('given empty stationId > throws', () => {
    expect(() => buildPlaysByDayQuery('', {})).toThrow();
  });
});

describe('buildTopTracksQuery', () => {
  test('scopes station_id', () => {
    const { sql, params } = buildTopTracksQuery('urban-radio', {});
    expect(sql).toMatch(/FROM play_log/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
  });

  test('groups by title and artist with COUNT(*) plays, ordered DESC', () => {
    const { sql } = buildTopTracksQuery('s', {});
    expect(sql).toMatch(/GROUP BY title_snapshot, artist_snapshot/);
    expect(sql).toMatch(/COUNT\(\*\)/);
    expect(sql).toMatch(/ORDER BY plays DESC/);
  });

  test('given limit 5 > LIMIT 5', () => {
    const { sql } = buildTopTracksQuery('s', {}, { limit: 5 });
    expect(sql).toMatch(/LIMIT 5/);
  });

  test('given limit 9999 > clamps to 200', () => {
    const { sql } = buildTopTracksQuery('s', {}, { limit: 9999 });
    expect(sql).toMatch(new RegExp(`LIMIT ${REPORT_MAX_TOP_LIMIT}`));
  });

  test('default limit is 25 when limit omitted', () => {
    const { sql } = buildTopTracksQuery('s', {});
    expect(sql).toMatch(new RegExp(`LIMIT ${REPORT_DEFAULT_TOP_LIMIT}`));
  });

  test('given date range > adds played_at filter', () => {
    const { sql, params } = buildTopTracksQuery('s', {
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });
    expect(sql).toMatch(/played_at >= \?/);
    expect(sql).toMatch(/played_at < \?/);
    expect(params).toContain('2026-01-01T00:00:00Z');
    expect(params).toContain('2026-02-01T00:00:00Z');
  });

  test('given source filter > adds source = ?', () => {
    const { sql, params } = buildTopTracksQuery('s', {}, { source: 'automation' });
    expect(sql).toMatch(/source = \?/);
    expect(params).toContain('automation');
  });

  test('given empty stationId > throws', () => {
    expect(() => buildTopTracksQuery('', {})).toThrow();
  });
});

describe('buildTopHoursQuery', () => {
  test('scopes station_id', () => {
    const { sql, params } = buildTopHoursQuery('urban-radio', {});
    expect(sql).toMatch(/FROM play_log/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
  });

  test('GROUP BY hour 0-23 via strftime("%H")', () => {
    const { sql } = buildTopHoursQuery('s', {});
    expect(sql).toMatch(/strftime\('%H', played_at\)/);
    expect(sql).toMatch(/GROUP BY hour/);
    expect(sql).toMatch(/ORDER BY hour ASC/);
  });

  test('given date range > adds played_at filter', () => {
    const { sql, params } = buildTopHoursQuery('s', {
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });
    expect(sql).toMatch(/played_at >= \?/);
    expect(sql).toMatch(/played_at < \?/);
    expect(params).toContain('2026-01-01T00:00:00Z');
    expect(params).toContain('2026-02-01T00:00:00Z');
  });

  test('given empty stationId > throws', () => {
    expect(() => buildTopHoursQuery('', {})).toThrow();
  });
});

describe('buildSourceBreakdownQuery', () => {
  test('scopes station_id', () => {
    const { sql, params } = buildSourceBreakdownQuery('urban-radio', {});
    expect(sql).toMatch(/FROM play_log/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
  });

  test('GROUP BY source', () => {
    const { sql } = buildSourceBreakdownQuery('s', {});
    expect(sql).toMatch(/GROUP BY source/);
    expect(sql).toMatch(/COUNT\(\*\)/);
  });

  test('given date range > adds played_at filter', () => {
    const { sql, params } = buildSourceBreakdownQuery('s', {
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });
    expect(sql).toMatch(/played_at >= \?/);
    expect(sql).toMatch(/played_at < \?/);
    expect(params).toContain('2026-01-01T00:00:00Z');
    expect(params).toContain('2026-02-01T00:00:00Z');
  });

  test('given empty stationId > throws', () => {
    expect(() => buildSourceBreakdownQuery('', {})).toThrow();
  });
});
