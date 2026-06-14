import { describe, test, expect } from 'vitest';
import { radioTrackToJson, type RadioTrackRow } from './catalog-map';

const baseRow: RadioTrackRow = {
  id: 't1',
  station_id: 'urban-radio',
  category_id: 'cat-music',
  title: 'Song',
  artist: 'Some Artist',
  album: 'Some Album',
  genre: 'pop',
  bpm: 120,
  music_key: 'C',
  energy: 5,
  era_year: 2024,
  language: 'en',
  duration_ms: 180000,
  cue_in_ms: 0,
  cue_out_ms: null,
  intro_ms: null,
  outro_ms: null,
  mix_point_ms: null,
  loudness_lufs: null,
  file_type: 'music',
  content_hash: 'hash-1',
  storage_key: 'tracks/t1.mp3',
  custom_f1: null,
  custom_f2: null,
  custom_f3: null,
  custom_f4: null,
  custom_f5: null,
  rating: 4,
  play_count: 0,
  last_played_at: null,
  date_added: '2026-05-01T00:00:00Z',
};

const request = new Request('http://localhost/api/catalog/tracks');

describe('radioTrackToJson', () => {
  test('given row with category_id > emits categoryId on output', () => {
    const out = radioTrackToJson(baseRow, request);
    expect(out.categoryId).toBe('cat-music');
  });

  test('given row with null category_id > emits categoryId as null', () => {
    const out = radioTrackToJson({ ...baseRow, category_id: null }, request);
    expect(out.categoryId).toBeNull();
  });

  test('keeps existing fields (id, title, artist) intact', () => {
    const out = radioTrackToJson(baseRow, request);
    expect(out.id).toBe('t1');
    expect(out.title).toBe('Song');
    expect(out.artist).toBe('Some Artist');
  });
});
