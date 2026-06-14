import { describe, test, expect } from 'vitest';
import { ASCAP_COLUMNS, ascapEmitter } from './ascap';
import { BOM, type RoyaltyRow, type StationContext, type RoyaltyRange } from './index';

const STATION: StationContext = {
  stationId: 'urban-radio',
  stationName: 'Urban Radio',
};

const RANGE: RoyaltyRange = {
  from: '2026-05-01T00:00:00Z',
  to: '2026-06-01T00:00:00Z',
};

describe('ascap emitter', () => {
  test('emits header row with the expected ASCAP columns', () => {
    const out = ascapEmitter.emit([], STATION, RANGE);
    // Strip BOM, then take the first line.
    const lines = out.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe(ASCAP_COLUMNS.join(','));
  });

  test('emits one data row per input row', () => {
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
        playedAt: '2026-05-13T10:05:00Z',
        title: 'Song B',
        artist: 'Artist B',
        durationMs: 200_000,
        isrc: null,
        iswc: null,
        source: 'live_dj',
      },
    ];
    const out = ascapEmitter.emit(rows, STATION, RANGE);
    const dataLines = out
      .replace(/^﻿/, '')
      .split('\r\n')
      .filter((l) => l.length > 0)
      .slice(1); // drop header
    expect(dataLines).toHaveLength(2);
  });

  test('escapes commas and quotes in titles per RFC 4180', () => {
    const rows: RoyaltyRow[] = [
      {
        playedAt: '2026-05-13T10:00:00Z',
        title: 'Hello, World',
        artist: 'She said "Hi"',
        durationMs: 0,
        isrc: null,
        iswc: null,
        source: 'automation',
      },
    ];
    const out = ascapEmitter.emit(rows, STATION, RANGE);
    expect(out).toContain('"Hello, World"');
    expect(out).toContain('"She said ""Hi"""');
  });

  test('formats date as YYYY-MM-DD and time as HH:MM:SS in UTC', () => {
    const rows: RoyaltyRow[] = [
      {
        playedAt: '2026-05-13T09:08:07Z',
        title: 'Song',
        artist: 'Artist',
        durationMs: 1000,
        isrc: null,
        iswc: null,
        source: 'automation',
      },
    ];
    const out = ascapEmitter.emit(rows, STATION, RANGE);
    expect(out).toContain('2026-05-13');
    expect(out).toContain('09:08:07');
  });

  test('rounds durationMs to whole seconds', () => {
    const rows: RoyaltyRow[] = [
      {
        playedAt: '2026-05-13T10:00:00Z',
        title: 'Song',
        artist: 'Artist',
        durationMs: 180_400,
        isrc: null,
        iswc: null,
        source: 'automation',
      },
    ];
    const out = ascapEmitter.emit(rows, STATION, RANGE);
    // Last data cell before line end should be Source; preceding cell is duration.
    const dataLine = out.replace(/^﻿/, '').split('\r\n')[1];
    expect(dataLine).toContain(',180,automation');
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
      'TitleOfWork,WriterPerformer,ISWC,ISRC,Date,TimePlayed,DurationSeconds,Source\r\n' +
      'Song A,Artist A,T-034.524.680-1,USRC17607839,2026-05-13,10:00:00,180,automation\r\n' +
      '"Hello, World",,,,2026-05-13,10:05:30,,live_dj\r\n';
    expect(ascapEmitter.emit(rows, STATION, RANGE)).toBe(expected);
  });
});
