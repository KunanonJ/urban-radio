import { describe, test, expect } from 'vitest';
import {
  buildTracksQuery,
  buildAlbumsQuery,
  buildArtistsQuery,
  buildPlaylistsQuery,
  encodeCursor,
  decodeCursor,
  buildTrackByIdQuery,
  buildAlbumDetailQuery,
  buildArtistDetailQuery,
  clampLimit,
  MAX_LIMIT,
  DEFAULT_LIMIT,
} from './catalog-queries';

describe('clampLimit', () => {
  test('given undefined > returns DEFAULT_LIMIT', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_LIMIT);
  });

  test('given zero or negative > returns DEFAULT_LIMIT', () => {
    expect(clampLimit(0)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(-10)).toBe(DEFAULT_LIMIT);
  });

  test('given value > MAX_LIMIT > clamps to MAX_LIMIT', () => {
    expect(clampLimit(5000)).toBe(MAX_LIMIT);
    expect(clampLimit(MAX_LIMIT + 1)).toBe(MAX_LIMIT);
  });

  test('given valid value > returns it', () => {
    expect(clampLimit(50)).toBe(50);
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(MAX_LIMIT)).toBe(MAX_LIMIT);
  });
});

describe('encodeCursor / decodeCursor', () => {
  test('given valid cursor > round-trips', () => {
    const encoded = encodeCursor({ lastDate: '2026-01-01T00:00:00Z', lastId: 'abc' });
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual({ lastDate: '2026-01-01T00:00:00Z', lastId: 'abc' });
  });

  test('given undefined or empty string > returns null', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  test('given malformed cursor > returns null', () => {
    expect(decodeCursor('not-base64-json!!!')).toBeNull();
  });

  test('given base64 of invalid JSON > returns null', () => {
    const garbage = Buffer.from('not json', 'utf8').toString('base64url');
    expect(decodeCursor(garbage)).toBeNull();
  });

  test('given object missing fields > returns null', () => {
    const partial = Buffer.from(JSON.stringify({ lastDate: '2026-01-01' }), 'utf8').toString(
      'base64url',
    );
    expect(decodeCursor(partial)).toBeNull();
  });
});

describe('buildTracksQuery', () => {
  test('given stationId only > builds SELECT with station_id filter first', () => {
    const { sql, params } = buildTracksQuery({ stationId: 'urban-radio', limit: 50 });
    expect(sql).toMatch(/FROM radio_tracks/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
  });

  test('given stationId > orders by date_added DESC, id DESC for keyset stability', () => {
    const { sql } = buildTracksQuery({ stationId: 's', limit: 10 });
    expect(sql).toMatch(/ORDER BY date_added DESC, id DESC/);
  });

  test('given cursor > adds keyset WHERE with date and id pair', () => {
    const { sql, params } = buildTracksQuery({
      stationId: 's',
      cursor: { lastDate: '2026-01-01T12:00:00Z', lastId: 'abc' },
      limit: 10,
    });
    expect(sql).toMatch(/\(date_added, id\) < \(\?, \?\)/);
    expect(params).toContain('2026-01-01T12:00:00Z');
    expect(params).toContain('abc');
  });

  test('given search filter > adds LIKE clauses for title and artist', () => {
    const { sql, params } = buildTracksQuery({
      stationId: 's',
      limit: 10,
      filters: { search: 'foo' },
    });
    expect(sql).toMatch(/title LIKE \?/);
    expect(sql).toMatch(/artist LIKE \?/);
    expect(params.filter((p) => p === '%foo%')).toHaveLength(2);
  });

  test('given categoryId filter > adds category_id = ?', () => {
    const { sql, params } = buildTracksQuery({
      stationId: 's',
      limit: 10,
      filters: { categoryId: 'cat-music' },
    });
    expect(sql).toMatch(/category_id = \?/);
    expect(params).toContain('cat-music');
  });

  test('given fileType filter > adds file_type = ?', () => {
    const { sql, params } = buildTracksQuery({
      stationId: 's',
      limit: 10,
      filters: { fileType: 'music' },
    });
    expect(sql).toMatch(/file_type = \?/);
    expect(params).toContain('music');
  });

  test('given bpm range filter > adds bpm BETWEEN', () => {
    const { sql, params } = buildTracksQuery({
      stationId: 's',
      limit: 10,
      filters: { minBpm: 80, maxBpm: 140 },
    });
    expect(sql).toMatch(/bpm >= \?/);
    expect(sql).toMatch(/bpm <= \?/);
    expect(params).toContain(80);
    expect(params).toContain(140);
  });

  test('given limit > MAX_LIMIT > clamps to MAX_LIMIT in SQL', () => {
    const { sql } = buildTracksQuery({ stationId: 's', limit: 5000 });
    expect(sql).toMatch(new RegExp(`LIMIT ${MAX_LIMIT}`));
  });

  test('given negative limit > clamps to DEFAULT_LIMIT', () => {
    const { sql } = buildTracksQuery({ stationId: 's', limit: -1 });
    expect(sql).toMatch(new RegExp(`LIMIT ${DEFAULT_LIMIT}`));
  });

  test('given no station > throws', () => {
    expect(() => buildTracksQuery({ stationId: '', limit: 10 })).toThrow();
  });
});

describe('buildAlbumsQuery', () => {
  test('given stationId > groups by album/artist filtered by station', () => {
    const { sql, params } = buildAlbumsQuery({ stationId: 's', limit: 10 });
    expect(sql).toMatch(/FROM radio_tracks/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(sql).toMatch(/GROUP BY/);
    expect(params[0]).toBe('s');
  });

  test('given search filter > adds LIKE on album name', () => {
    const { sql, params } = buildAlbumsQuery({
      stationId: 's',
      limit: 10,
      filters: { search: 'foo' },
    });
    expect(sql).toMatch(/LIKE \?/);
    expect(params).toContain('%foo%');
  });

  test('given limit clamps to MAX_LIMIT', () => {
    const { sql } = buildAlbumsQuery({ stationId: 's', limit: 9999 });
    expect(sql).toMatch(new RegExp(`LIMIT ${MAX_LIMIT}`));
  });
});

describe('buildArtistsQuery', () => {
  test('given stationId > groups by artist filtered by station', () => {
    const { sql, params } = buildArtistsQuery({ stationId: 's', limit: 10 });
    expect(sql).toMatch(/FROM radio_tracks/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(sql).toMatch(/GROUP BY/);
    expect(params[0]).toBe('s');
  });

  test('given search filter > adds LIKE on artist name', () => {
    const { sql, params } = buildArtistsQuery({
      stationId: 's',
      limit: 10,
      filters: { search: 'foo' },
    });
    expect(sql).toMatch(/LIKE \?/);
    expect(params).toContain('%foo%');
  });
});

describe('buildPlaylistsQuery', () => {
  test('given stationId > returns query scoped by station', () => {
    const { sql, params } = buildPlaylistsQuery({ stationId: 's', limit: 10 });
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('s');
  });
});

describe('buildTrackByIdQuery', () => {
  test('returns SQL with station_id and id binds (station first)', () => {
    const { sql, params } = buildTrackByIdQuery({ stationId: 's', id: 't1' });
    expect(sql).toMatch(/FROM radio_tracks/);
    expect(sql).toMatch(/WHERE station_id = \? AND id = \?/);
    expect(params).toEqual(['s', 't1']);
  });
});

describe('buildAlbumDetailQuery', () => {
  test('returns SQL with station_id and album group key', () => {
    const { sql, params } = buildAlbumDetailQuery({ stationId: 's', albumKey: 'my-album' });
    expect(sql).toMatch(/FROM radio_tracks/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('s');
    expect(params).toContain('my-album');
  });
});

describe('buildArtistDetailQuery', () => {
  test('returns SQL with station_id and artist group key', () => {
    const { sql, params } = buildArtistDetailQuery({
      stationId: 's',
      artistKey: 'some-artist',
    });
    expect(sql).toMatch(/FROM radio_tracks/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('s');
    expect(params).toContain('some-artist');
  });
});
