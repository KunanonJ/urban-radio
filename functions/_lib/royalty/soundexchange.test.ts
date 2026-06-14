import { describe, test, expect } from 'vitest';
import {
  SOUNDEXCHANGE_COLUMNS,
  SOUNDEXCHANGE_TRANSMISSION_CATEGORY,
  soundExchangeEmitter,
} from './soundexchange';
import { BOM, type RoyaltyRow, type StationContext, type RoyaltyRange } from './index';

const STATION: StationContext = {
  stationId: 'urban-radio',
  stationName: 'Urban Radio',
};

const RANGE: RoyaltyRange = {
  from: '2026-05-01T00:00:00Z',
  to: '2026-06-01T00:00:00Z',
};

describe('soundexchange emitter', () => {
  test('emits header row with the expected DPR columns', () => {
    const out = soundExchangeEmitter.emit([], STATION, RANGE);
    const lines = out.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe(SOUNDEXCHANGE_COLUMNS.join(','));
  });

  test('emits one data row per input row (ActualTotalPerformances=1 each)', () => {
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
        isrc: 'USRC17607840',
        iswc: null,
        source: 'automation',
      },
    ];
    const dataLines = soundExchangeEmitter
      .emit(rows, STATION, RANGE)
      .replace(/^﻿/, '')
      .split('\r\n')
      .filter((l) => l.length > 0)
      .slice(1);
    expect(dataLines).toHaveLength(2);
    for (const l of dataLines) expect(l.endsWith(',1')).toBe(true);
  });

  test('emits stationName as NameOfService', () => {
    const rows: RoyaltyRow[] = [
      {
        playedAt: '2026-05-13T10:00:00Z',
        title: 'Song',
        artist: 'Artist',
        durationMs: 1000,
        isrc: null,
        iswc: null,
        source: 'automation',
      },
    ];
    const out = soundExchangeEmitter.emit(rows, STATION, RANGE);
    const dataLine = out.replace(/^﻿/, '').split('\r\n')[1];
    expect(dataLine.startsWith(`${STATION.stationName},`)).toBe(true);
  });

  test('escapes commas/quotes in station name and title', () => {
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
    const ctx: StationContext = { stationId: 'x', stationName: 'My Station, Inc.' };
    const out = soundExchangeEmitter.emit(rows, ctx, RANGE);
    expect(out).toContain('"My Station, Inc."');
    expect(out).toContain('"Hello, World"');
    expect(out).toContain('"She said ""Hi"""');
  });

  test('emits fixed TransmissionCategory = Webcasting', () => {
    const rows: RoyaltyRow[] = [
      {
        playedAt: '2026-05-13T10:00:00Z',
        title: 'Song',
        artist: 'Artist',
        durationMs: 1000,
        isrc: null,
        iswc: null,
        source: 'automation',
      },
    ];
    const out = soundExchangeEmitter.emit(rows, STATION, RANGE);
    const dataLine = out.replace(/^﻿/, '').split('\r\n')[1];
    const cells = dataLine.split(',');
    // Cell 1 (0-indexed) is TransmissionCategory.
    expect(cells[1]).toBe(SOUNDEXCHANGE_TRANSMISSION_CATEGORY);
  });

  test('Album and MarketingLabel are blank (FOLLOW-UP)', () => {
    const rows: RoyaltyRow[] = [
      {
        playedAt: '2026-05-13T10:00:00Z',
        title: 'Song',
        artist: 'Artist',
        durationMs: 1000,
        isrc: 'USRC17607839',
        iswc: null,
        source: 'automation',
      },
    ];
    const out = soundExchangeEmitter.emit(rows, STATION, RANGE);
    const dataLine = out.replace(/^﻿/, '').split('\r\n')[1];
    const cells = dataLine.split(',');
    // 0=Service, 1=Cat, 2=Artist, 3=Title, 4=ISRC, 5=Album, 6=Label, 7=Count
    expect(cells[5]).toBe('');
    expect(cells[6]).toBe('');
  });

  test('golden file > matches expected CSV byte-for-byte', () => {
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
      'NameOfService,TransmissionCategory,FeaturedArtist,SoundRecordingTitle,ISRC,Album,MarketingLabel,ActualTotalPerformances\r\n' +
      'Urban Radio,Webcasting,Artist A,Song A,USRC17607839,,,1\r\n' +
      'Urban Radio,Webcasting,,"Hello, World",,,,1\r\n';
    expect(soundExchangeEmitter.emit(rows, STATION, RANGE)).toBe(expected);
  });
});
