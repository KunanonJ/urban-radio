import { describe, test, expect } from 'vitest';
import {
  buildPlayLogListQuery,
  buildPlayLogInsert,
  buildPlayLogAggregateQuery,
  clampLimit,
  encodeCursor,
  decodeCursor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  ALLOWED_SOURCES,
  type PlayLogEntry,
} from './play-log-queries';

describe('clampLimit', () => {
  test('given undefined > returns default', () => {
    expect(clampLimit(undefined, MAX_LIMIT, DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
  });

  test('given zero or negative > returns default', () => {
    expect(clampLimit(0, MAX_LIMIT, DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(-50, MAX_LIMIT, DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
  });

  test('given value > max > clamps to max', () => {
    expect(clampLimit(5000, MAX_LIMIT, DEFAULT_LIMIT)).toBe(MAX_LIMIT);
    expect(clampLimit(MAX_LIMIT + 1, MAX_LIMIT, DEFAULT_LIMIT)).toBe(MAX_LIMIT);
  });

  test('given valid value > returns it', () => {
    expect(clampLimit(100, MAX_LIMIT, DEFAULT_LIMIT)).toBe(100);
    expect(clampLimit(MAX_LIMIT, MAX_LIMIT, DEFAULT_LIMIT)).toBe(MAX_LIMIT);
  });
});

describe('encodeCursor / decodeCursor', () => {
  test('given valid cursor > round-trips', () => {
    const cursor = { lastPlayedAt: '2026-05-13T10:00:00Z', lastId: 'play-1' };
    const encoded = encodeCursor(cursor);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(cursor);
  });

  test('given undefined or null > returns null', () => {
    expect(decodeCursor(undefined as unknown as string)).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  test('given malformed cursor > returns null', () => {
    expect(decodeCursor('bogus-!!!!')).toBeNull();
  });

  test('given object missing lastId > returns null', () => {
    const partial = Buffer.from(JSON.stringify({ lastPlayedAt: 'x' }), 'utf8').toString('base64url');
    expect(decodeCursor(partial)).toBeNull();
  });
});

describe('buildPlayLogListQuery', () => {
  test('scopes station_id as the first predicate', () => {
    const { sql, params } = buildPlayLogListQuery({
      stationId: 'urban-radio',
      limit: 100,
    });
    expect(sql).toMatch(/FROM play_log/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
  });

  test('given from + to > adds played_at >= ? AND played_at < ?', () => {
    const { sql, params } = buildPlayLogListQuery({
      stationId: 's',
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
      limit: 100,
    });
    expect(sql).toMatch(/played_at >= \?/);
    expect(sql).toMatch(/played_at < \?/);
    expect(params).toContain('2026-01-01T00:00:00Z');
    expect(params).toContain('2026-02-01T00:00:00Z');
  });

  test('given source filter > adds source = ?', () => {
    const { sql, params } = buildPlayLogListQuery({
      stationId: 's',
      source: 'automation',
      limit: 100,
    });
    expect(sql).toMatch(/source = \?/);
    expect(params).toContain('automation');
  });

  test('given trackId filter > adds track_id = ?', () => {
    const { sql, params } = buildPlayLogListQuery({
      stationId: 's',
      trackId: 'track-99',
      limit: 100,
    });
    expect(sql).toMatch(/track_id = \?/);
    expect(params).toContain('track-99');
  });

  test('given cursor > adds keyset WHERE (played_at, id) < (?, ?)', () => {
    const { sql, params } = buildPlayLogListQuery({
      stationId: 's',
      cursor: { lastPlayedAt: '2026-05-13T10:00:00Z', lastId: 'play-1' },
      limit: 100,
    });
    expect(sql).toMatch(/\(played_at, id\) < \(\?, \?\)/);
    expect(params).toContain('2026-05-13T10:00:00Z');
    expect(params).toContain('play-1');
  });

  test('orders by played_at DESC, id DESC for keyset stability', () => {
    const { sql } = buildPlayLogListQuery({ stationId: 's', limit: 100 });
    expect(sql).toMatch(/ORDER BY played_at DESC, id DESC/);
  });

  test('clamps limit > MAX_LIMIT (1000) into SQL', () => {
    const { sql } = buildPlayLogListQuery({ stationId: 's', limit: 9999 });
    expect(sql).toMatch(new RegExp(`LIMIT ${MAX_LIMIT}`));
  });

  test('given no station > throws', () => {
    expect(() => buildPlayLogListQuery({ stationId: '', limit: 100 })).toThrow();
  });

  test('selects all required columns', () => {
    const { sql } = buildPlayLogListQuery({ stationId: 's', limit: 100 });
    expect(sql).toMatch(/id/);
    expect(sql).toMatch(/station_id/);
    expect(sql).toMatch(/track_id/);
    expect(sql).toMatch(/title_snapshot/);
    expect(sql).toMatch(/artist_snapshot/);
    expect(sql).toMatch(/played_at/);
    expect(sql).toMatch(/duration_played_ms/);
    expect(sql).toMatch(/source/);
    expect(sql).toMatch(/isrc/);
    expect(sql).toMatch(/iswc/);
  });
});

describe('buildPlayLogInsert', () => {
  test('requires title_snapshot', () => {
    const entry: PlayLogEntry = {
      id: 'p1',
      stationId: 's',
      titleSnapshot: '',
      playedAt: '2026-05-13T10:00:00Z',
      source: 'automation',
    };
    expect(() => buildPlayLogInsert(entry)).toThrow();
  });

  test('requires stationId', () => {
    const entry: PlayLogEntry = {
      id: 'p1',
      stationId: '',
      titleSnapshot: 'Song',
      playedAt: '2026-05-13T10:00:00Z',
      source: 'automation',
    };
    expect(() => buildPlayLogInsert(entry)).toThrow();
  });

  test('requires id', () => {
    const entry: PlayLogEntry = {
      id: '',
      stationId: 's',
      titleSnapshot: 'Song',
      playedAt: '2026-05-13T10:00:00Z',
      source: 'automation',
    };
    expect(() => buildPlayLogInsert(entry)).toThrow();
  });

  test('builds INSERT with all columns + binds in correct order', () => {
    const { sql, params } = buildPlayLogInsert({
      id: 'p1',
      stationId: 's',
      trackId: 't1',
      titleSnapshot: 'Song Title',
      artistSnapshot: 'Some Artist',
      playedAt: '2026-05-13T10:00:00Z',
      durationPlayedMs: 180000,
      source: 'automation',
      isrc: 'USRC17607839',
      iswc: 'T-034.524.680-1',
    });
    expect(sql).toMatch(/INSERT INTO play_log/);
    expect(sql).toMatch(/title_snapshot/);
    expect(params).toContain('p1');
    expect(params).toContain('s');
    expect(params).toContain('Song Title');
    expect(params).toContain('Some Artist');
    expect(params).toContain('automation');
    expect(params).toContain(180000);
    expect(params).toContain('USRC17607839');
  });

  test('defaults played_at to datetime("now") via SQL when not provided', () => {
    const { sql, params } = buildPlayLogInsert({
      id: 'p1',
      stationId: 's',
      titleSnapshot: 'Song',
      source: 'automation',
    });
    expect(sql).toMatch(/datetime\('now'\)/);
    expect(params).not.toContain(undefined);
  });

  test('defaults nullable fields to null', () => {
    const { params } = buildPlayLogInsert({
      id: 'p1',
      stationId: 's',
      titleSnapshot: 'Song',
      source: 'automation',
    });
    // track_id, artist_snapshot, duration_played_ms, isrc, iswc all default to null.
    const nulls = params.filter((p) => p === null);
    expect(nulls.length).toBeGreaterThanOrEqual(5);
  });

  test('rejects sources not in ALLOWED_SOURCES set', () => {
    expect(() =>
      buildPlayLogInsert({
        id: 'p1',
        stationId: 's',
        titleSnapshot: 'Song',
        source: 'now_playing' as 'automation',
      }),
    ).toThrow(/source/);
  });

  test('ALLOWED_SOURCES matches migration 0004 CHECK constraint', () => {
    expect(ALLOWED_SOURCES).toEqual([
      'automation',
      'manual',
      'live_dj',
      'voice_track',
      'cart',
      'spot',
    ]);
  });
});

describe('buildPlayLogAggregateQuery', () => {
  test('scopes station_id', () => {
    const { sql, params } = buildPlayLogAggregateQuery({ stationId: 'urban-radio' });
    expect(sql).toMatch(/FROM play_log/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
  });

  test('groups by title and artist with COUNT(*) plays', () => {
    const { sql } = buildPlayLogAggregateQuery({ stationId: 's' });
    expect(sql).toMatch(/GROUP BY title_snapshot, artist_snapshot/);
    expect(sql).toMatch(/COUNT\(\*\)/);
  });

  test('orders by plays DESC for top-plays view', () => {
    const { sql } = buildPlayLogAggregateQuery({ stationId: 's' });
    expect(sql).toMatch(/ORDER BY plays DESC/);
  });

  test('given from + to > adds date range filter', () => {
    const { sql, params } = buildPlayLogAggregateQuery({
      stationId: 's',
      from: '2026-01-01T00:00:00Z',
      to: '2026-02-01T00:00:00Z',
    });
    expect(sql).toMatch(/played_at >= \?/);
    expect(sql).toMatch(/played_at < \?/);
    expect(params).toContain('2026-01-01T00:00:00Z');
    expect(params).toContain('2026-02-01T00:00:00Z');
  });

  test('given no stationId > throws', () => {
    expect(() => buildPlayLogAggregateQuery({ stationId: '' })).toThrow();
  });
});
