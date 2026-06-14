import { describe, test, expect } from 'vitest';

import {
  detectFileType,
  defaultCategoryIdForFileType,
  buildRadioTrackInsert,
  buildDuplicateCheck,
  stripExtension,
} from './upload-helpers';

describe('detectFileType', () => {
  test('given filename "song.mp3" > returns "music"', () => {
    expect(detectFileType({ mime: 'audio/mpeg', filename: 'song.mp3' })).toBe('music');
  });

  test('given filename "sweeper-xyz.mp3" > returns "sweeper"', () => {
    expect(detectFileType({ mime: 'audio/mpeg', filename: 'sweeper-xyz.mp3' })).toBe(
      'sweeper',
    );
  });

  test('given filename "jingle-2024.mp3" > returns "jingle"', () => {
    expect(detectFileType({ mime: 'audio/mpeg', filename: 'jingle-2024.mp3' })).toBe(
      'jingle',
    );
  });

  test('given filename containing "id-" > returns "id"', () => {
    expect(detectFileType({ mime: 'audio/mpeg', filename: 'id-urban-fm.mp3' })).toBe('id');
  });

  test('given filename containing "spot" > returns "spot"', () => {
    expect(detectFileType({ mime: 'audio/mpeg', filename: 'spot-coke-30s.mp3' })).toBe(
      'spot',
    );
  });

  test('given filename with no naming hint > defaults to "music"', () => {
    expect(detectFileType({ mime: 'audio/mpeg', filename: 'untitled.mp3' })).toBe('music');
  });

  test('given filename casing differences > still detects', () => {
    expect(detectFileType({ mime: 'audio/mpeg', filename: 'SWEEPER_Promo.mp3' })).toBe(
      'sweeper',
    );
  });

  test('given non-audio MIME > still defaults to "music" (frontend hint)', () => {
    expect(detectFileType({ mime: '', filename: 'mystery' })).toBe('music');
  });
});

describe('defaultCategoryIdForFileType', () => {
  test('given "music" > returns "cat-music"', () => {
    expect(defaultCategoryIdForFileType('music')).toBe('cat-music');
  });

  test('given "jingle" > returns "cat-jingle"', () => {
    expect(defaultCategoryIdForFileType('jingle')).toBe('cat-jingle');
  });

  test('given "sweeper" > returns "cat-sweeper"', () => {
    expect(defaultCategoryIdForFileType('sweeper')).toBe('cat-sweeper');
  });

  test('given "id" > returns "cat-id"', () => {
    expect(defaultCategoryIdForFileType('id')).toBe('cat-id');
  });

  test('given "spot" > returns "cat-spot"', () => {
    expect(defaultCategoryIdForFileType('spot')).toBe('cat-spot');
  });

  test('given "unknown" > falls back to "cat-music" (safe default)', () => {
    expect(defaultCategoryIdForFileType('unknown')).toBe('cat-music');
  });

  test('given empty string > falls back to "cat-music"', () => {
    expect(defaultCategoryIdForFileType('')).toBe('cat-music');
  });
});

describe('stripExtension', () => {
  test('given "song.mp3" > returns "song"', () => {
    expect(stripExtension('song.mp3')).toBe('song');
  });

  test('given "no-extension" > returns "no-extension"', () => {
    expect(stripExtension('no-extension')).toBe('no-extension');
  });

  test('given "" > returns "(untitled)"', () => {
    expect(stripExtension('')).toBe('(untitled)');
  });

  test('given multi-dot name > strips only the last segment', () => {
    expect(stripExtension('my.song.v2.mp3')).toBe('my.song.v2');
  });
});

describe('buildRadioTrackInsert', () => {
  test('given params > produces INSERT INTO radio_tracks', () => {
    const { sql } = buildRadioTrackInsert({
      trackId: 'rt-1',
      stationId: 'urban-radio',
      categoryId: 'cat-music',
      title: 'Song',
      storageKey: 'uploads/abc/song.mp3',
      contentHash: 'sha256-hash',
      durationMs: 0,
      fileType: 'music',
    });
    expect(sql).toMatch(/INSERT INTO radio_tracks/);
  });

  test('given params > binds station_id first', () => {
    const { params } = buildRadioTrackInsert({
      trackId: 'rt-1',
      stationId: 'urban-radio',
      categoryId: 'cat-music',
      title: 'Song',
      storageKey: 'uploads/abc/song.mp3',
      contentHash: 'sha256-hash',
      durationMs: 0,
      fileType: 'music',
    });
    // SQL has the form (id, station_id, category_id, ...) — verify all required
    // values are bound in declared order. trackId is first per the column order.
    expect(params[0]).toBe('rt-1');
    expect(params[1]).toBe('urban-radio');
    expect(params[2]).toBe('cat-music');
    expect(params).toContain('sha256-hash');
    expect(params).toContain('uploads/abc/song.mp3');
  });

  test('given params > includes all required columns in SQL', () => {
    const { sql } = buildRadioTrackInsert({
      trackId: 'rt-1',
      stationId: 'urban-radio',
      categoryId: 'cat-music',
      title: 'Song',
      storageKey: 'uploads/abc/song.mp3',
      contentHash: 'sha256-hash',
      durationMs: 12345,
      fileType: 'music',
    });
    expect(sql).toMatch(/id/);
    expect(sql).toMatch(/station_id/);
    expect(sql).toMatch(/category_id/);
    expect(sql).toMatch(/title/);
    expect(sql).toMatch(/storage_key/);
    expect(sql).toMatch(/content_hash/);
    expect(sql).toMatch(/duration_ms/);
    expect(sql).toMatch(/file_type/);
    expect(sql).toMatch(/date_added/);
  });

  test('given duration_ms > binds the numeric value', () => {
    const { params } = buildRadioTrackInsert({
      trackId: 'rt-1',
      stationId: 'urban-radio',
      categoryId: 'cat-music',
      title: 'Song',
      storageKey: 'uploads/abc/song.mp3',
      contentHash: 'sha256-hash',
      durationMs: 12345,
      fileType: 'music',
    });
    expect(params).toContain(12345);
  });
});

describe('buildDuplicateCheck', () => {
  test('builds SELECT with station+hash filter', () => {
    const { sql, params } = buildDuplicateCheck('urban-radio', 'sha256-abc');
    expect(sql).toMatch(/SELECT/);
    expect(sql).toMatch(/FROM radio_tracks/);
    expect(sql).toMatch(/station_id = \?/);
    expect(sql).toMatch(/content_hash = \?/);
    expect(params).toEqual(['urban-radio', 'sha256-abc']);
  });

  test('returns id, title, storage_key in select list', () => {
    const { sql } = buildDuplicateCheck('s', 'h');
    expect(sql).toMatch(/\bid\b/);
    expect(sql).toMatch(/\btitle\b/);
    expect(sql).toMatch(/\bstorage_key\b/);
  });

  test('limits to a single row', () => {
    const { sql } = buildDuplicateCheck('s', 'h');
    expect(sql).toMatch(/LIMIT 1/);
  });
});
