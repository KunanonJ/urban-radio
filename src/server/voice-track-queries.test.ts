// @vitest-environment node

/**
 * Unit tests for voice-track-queries pure helpers.
 *
 * Focus: `generateStorageKey` input validation (Pentest L-03). The storage key
 * is interpolated straight into an R2/S3 object path, so a stationId or trackId
 * containing path separators or traversal sequences (`/`, `..`, `\`) would let
 * a caller escape the per-station prefix and read/write/delete objects under
 * another tenant's namespace. The generator must reject anything that is not a
 * safe key segment.
 */

import { describe, expect, test } from 'vitest';

import { generateStorageKey } from './voice-track-queries';

describe('generateStorageKey', () => {
  test('builds the per-station key for safe UUID-shaped inputs', () => {
    const key = generateStorageKey(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(key).toBe(
      'stations/11111111-1111-4111-8111-111111111111/voice-tracks/22222222-2222-4222-8222-222222222222.mp3',
    );
  });

  test('accepts plain alphanumerics, dots, dashes and underscores', () => {
    const key = generateStorageKey('station_A-1', 'track.B-2', 'wav');
    expect(key).toBe('stations/station_A-1/voice-tracks/track.B-2.wav');
  });

  test('rejects a stationId containing a path separator', () => {
    expect(() =>
      generateStorageKey('../other-station', 'track-1'),
    ).toThrow(/stationId/);
  });

  test('rejects a trackId containing a path separator', () => {
    expect(() =>
      generateStorageKey('station-1', 'a/b/../../etc/passwd'),
    ).toThrow(/trackId/);
  });

  test('rejects a stationId containing a backslash', () => {
    expect(() =>
      generateStorageKey('station\\evil', 'track-1'),
    ).toThrow(/stationId/);
  });

  test('rejects a trackId with a bare `..` traversal segment', () => {
    expect(() => generateStorageKey('station-1', '..')).toThrow(/trackId/);
  });

  test('still rejects empty inputs', () => {
    expect(() => generateStorageKey('', 'track-1')).toThrow(/stationId/);
    expect(() => generateStorageKey('station-1', '')).toThrow(/trackId/);
  });
});
