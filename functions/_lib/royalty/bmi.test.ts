import { describe, test, expect } from 'vitest';
import { BMI_COLUMNS, bmiEmitter } from './bmi';
import { BOM, type RoyaltyRow, type StationContext, type RoyaltyRange } from './index';

const STATION: StationContext = {
  stationId: 'urban-radio',
  stationName: 'Urban Radio',
};

const RANGE: RoyaltyRange = {
  from: '2026-05-01T00:00:00Z',
  to: '2026-06-01T00:00:00Z',
};

describe('bmi emitter', () => {
  test('emits header row with the expected BMI columns', () => {
    const out = bmiEmitter.emit([], STATION, RANGE);
    const lines = out.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe(BMI_COLUMNS.join(','));
  });

  test('emits one data row per input row', () => {
    const rows: RoyaltyRow[] = [
      {
        playedAt: '2026-05-13T10:00:00Z',
        title: 'Song A',
        artist: 'Artist A',
        durationMs: 180_000,
        isrc: 'USRC17607839',
        iswc: null,
        source: 'automation',
      },
      {
        playedAt: '2026-05-13T10:05:00Z',
        title: 'Song B',
        artist: 'Artist B',
        durationMs: 200_000,
        isrc: null,
        iswc: null,
        source: 'cart',
      },
      {
        playedAt: '2026-05-13T10:10:00Z',
        title: 'Song C',
        artist: 'Artist C',
        durationMs: 240_000,
        isrc: null,
        iswc: null,
        source: 'voice_track',
      },
    ];
    const dataLines = bmiEmitter
      .emit(rows, STATION, RANGE)
      .replace(/^﻿/, '')
      .split('\r\n')
      .filter((l) => l.length > 0)
      .slice(1);
    expect(dataLines).toHaveLength(3);
  });

  test('escapes commas and quotes in titles per RFC 4180', () => {
    const rows: RoyaltyRow[] = [
      {
        playedAt: '2026-05-13T10:00:00Z',
        title: 'Track, Take 2',
        artist: 'a "feat" b',
        durationMs: 0,
        isrc: null,
        iswc: null,
        source: 'automation',
      },
    ];
    const out = bmiEmitter.emit(rows, STATION, RANGE);
    expect(out).toContain('"Track, Take 2"');
    expect(out).toContain('"a ""feat"" b"');
  });

  test('formats date as YYYY-MM-DD and time as HH:MM:SS in UTC', () => {
    const rows: RoyaltyRow[] = [
      {
        playedAt: '2026-01-02T03:04:05Z',
        title: 'Song',
        artist: 'Artist',
        durationMs: 1000,
        isrc: null,
        iswc: null,
        source: 'automation',
      },
    ];
    const out = bmiEmitter.emit(rows, STATION, RANGE);
    expect(out).toContain('2026-01-02');
    expect(out).toContain('03:04:05');
  });

  test('uses play_log.source as FeatureType (passthrough)', () => {
    const rows: RoyaltyRow[] = [
      {
        playedAt: '2026-05-13T10:00:00Z',
        title: 'Song',
        artist: 'Artist',
        durationMs: 1000,
        isrc: null,
        iswc: null,
        source: 'voice_track',
      },
    ];
    const out = bmiEmitter.emit(rows, STATION, RANGE);
    const dataLine = out.replace(/^﻿/, '').split('\r\n')[1];
    expect(dataLine.endsWith(',voice_track')).toBe(true);
  });

  test('golden file > matches expected CSV byte-for-byte', () => {
    const rows: RoyaltyRow[] = [
      {
        playedAt: '2026-05-13T10:00:00Z',
        title: 'Song A',
        artist: 'Artist A',
        durationMs: 180_000,
        isrc: 'USRC17607839',
        iswc: 'T-034.524.680-1',
        source: 'automation',
      },
      {
        playedAt: '2026-05-13T10:05:30Z',
        title: 'Hello, World',
        artist: null,
        durationMs: null,
        isrc: null,
        iswc: null,
        source: 'live_dj',
      },
    ];
    const expected =
      BOM +
      'SongTitle,Artist,ISRC,ISWC,PlayDate,PlayTime,DurationSeconds,FeatureType\r\n' +
      'Song A,Artist A,USRC17607839,T-034.524.680-1,2026-05-13,10:00:00,180,automation\r\n' +
      '"Hello, World",,,,2026-05-13,10:05:30,,live_dj\r\n';
    expect(bmiEmitter.emit(rows, STATION, RANGE)).toBe(expected);
  });
});
