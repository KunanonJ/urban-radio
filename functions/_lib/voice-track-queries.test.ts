import { describe, test, expect } from 'vitest';
import {
  buildVoiceTracksListQuery,
  buildVoiceTrackInsert,
  buildVoiceTrackUpdate,
  buildVoiceTrackDelete,
  buildVoiceTrackByIdQuery,
  clampLimit,
  encodeCursor,
  decodeCursor,
  generateStorageKey,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  VT_STATUSES,
  type VoiceTrackRow,
} from './voice-track-queries';

describe('clampLimit', () => {
  test('given undefined > uses default', () => {
    expect(clampLimit(undefined, MAX_LIMIT, DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
  });

  test('given value > max > clamps to max', () => {
    expect(clampLimit(5000, MAX_LIMIT, DEFAULT_LIMIT)).toBe(MAX_LIMIT);
    expect(clampLimit(MAX_LIMIT + 1, MAX_LIMIT, DEFAULT_LIMIT)).toBe(MAX_LIMIT);
  });

  test('given zero or negative > returns default', () => {
    expect(clampLimit(0, MAX_LIMIT, DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(-1, MAX_LIMIT, DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
  });

  test('given valid value > returns it', () => {
    expect(clampLimit(50, MAX_LIMIT, DEFAULT_LIMIT)).toBe(50);
  });
});

describe('encodeCursor / decodeCursor', () => {
  test('given valid cursor > round-trips', () => {
    const cursor = { lastCreatedAt: '2026-05-14T10:00:00Z', lastId: 'vt-1' };
    const encoded = encodeCursor(cursor);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(cursor);
  });

  test('given null/empty > returns null', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  test('given malformed cursor > returns null', () => {
    expect(decodeCursor('bogus-!!!!')).toBeNull();
  });

  test('given object missing lastId > returns null', () => {
    const partial = Buffer.from(
      JSON.stringify({ lastCreatedAt: 'x' }),
      'utf8',
    ).toString('base64url');
    expect(decodeCursor(partial)).toBeNull();
  });
});

describe('generateStorageKey', () => {
  test('formats path as stations/<stationId>/voice-tracks/<id>.<ext>', () => {
    expect(generateStorageKey('urban-radio', 'vt-1')).toBe(
      'stations/urban-radio/voice-tracks/vt-1.mp3',
    );
  });

  test('honours custom extension', () => {
    expect(generateStorageKey('urban-radio', 'vt-1', 'wav')).toBe(
      'stations/urban-radio/voice-tracks/vt-1.wav',
    );
  });

  test('given missing stationId > throws', () => {
    expect(() => generateStorageKey('', 'vt-1')).toThrow();
  });

  test('given missing trackId > throws', () => {
    expect(() => generateStorageKey('urban-radio', '')).toThrow();
  });
});

describe('buildVoiceTracksListQuery', () => {
  test('scopes station_id as the first predicate', () => {
    const { sql, params } = buildVoiceTracksListQuery({
      stationId: 'urban-radio',
      limit: 50,
    });
    expect(sql).toMatch(/FROM voice_tracks/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
  });

  test('given status filter > adds AND status = ?', () => {
    const { sql, params } = buildVoiceTracksListQuery({
      stationId: 's',
      status: 'ready',
      limit: 50,
    });
    expect(sql).toMatch(/status = \?/);
    expect(params).toContain('ready');
  });

  test('given targetClockSlotId filter > adds AND target_clock_slot_id = ?', () => {
    const { sql, params } = buildVoiceTracksListQuery({
      stationId: 's',
      targetClockSlotId: 'slot-123',
      limit: 50,
    });
    expect(sql).toMatch(/target_clock_slot_id = \?/);
    expect(params).toContain('slot-123');
  });

  test('given cursor > adds keyset WHERE (created_at, id) < (?, ?)', () => {
    const { sql, params } = buildVoiceTracksListQuery({
      stationId: 's',
      cursor: { lastCreatedAt: '2026-05-14T10:00:00Z', lastId: 'vt-1' },
      limit: 50,
    });
    expect(sql).toMatch(/\(created_at, id\) < \(\?, \?\)/);
    expect(params).toContain('2026-05-14T10:00:00Z');
    expect(params).toContain('vt-1');
  });

  test('orders by created_at DESC, id DESC for keyset stability', () => {
    const { sql } = buildVoiceTracksListQuery({ stationId: 's', limit: 50 });
    expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/);
  });

  test('clamps limit > MAX_LIMIT (200) into SQL', () => {
    const { sql } = buildVoiceTracksListQuery({ stationId: 's', limit: 9999 });
    expect(sql).toMatch(new RegExp(`LIMIT ${MAX_LIMIT}`));
  });

  test('given missing stationId > throws', () => {
    expect(() => buildVoiceTracksListQuery({ stationId: '', limit: 50 })).toThrow();
  });
});

describe('buildVoiceTrackByIdQuery', () => {
  test('selects station-scoped row by id', () => {
    const { sql, params } = buildVoiceTrackByIdQuery('s', 'vt-1');
    expect(sql).toMatch(/FROM voice_tracks/);
    expect(sql).toMatch(/WHERE station_id = \? AND id = \?/);
    expect(params).toEqual(['s', 'vt-1']);
  });
});

describe('buildVoiceTrackInsert', () => {
  test('requires storage_key', () => {
    const row: Omit<VoiceTrackRow, 'createdAt'> = {
      id: 'vt-1',
      stationId: 's',
      recordedBy: 'user-1',
      storageKey: '',
      durationMs: 12000,
      transcript: null,
      targetClockSlotId: null,
      status: 'draft',
      aiGenerated: 0,
    };
    expect(() => buildVoiceTrackInsert(row)).toThrow();
  });

  test('requires id and stationId', () => {
    const base: Omit<VoiceTrackRow, 'createdAt'> = {
      id: '',
      stationId: 's',
      recordedBy: null,
      storageKey: 'k',
      durationMs: 0,
      transcript: null,
      targetClockSlotId: null,
      status: 'draft',
      aiGenerated: 0,
    };
    expect(() => buildVoiceTrackInsert(base)).toThrow();
    expect(() =>
      buildVoiceTrackInsert({ ...base, id: 'vt-1', stationId: '' }),
    ).toThrow();
  });

  test('defaults status=draft when status omitted', () => {
    const { sql, params } = buildVoiceTrackInsert({
      id: 'vt-1',
      stationId: 's',
      recordedBy: null,
      storageKey: 'k',
      durationMs: 1000,
      transcript: null,
      targetClockSlotId: null,
      status: undefined as unknown as 'draft',
      aiGenerated: 0,
    });
    expect(sql).toMatch(/INSERT INTO voice_tracks/);
    expect(params).toContain('draft');
  });

  test('builds INSERT with all columns and bind ordering', () => {
    const { sql, params } = buildVoiceTrackInsert({
      id: 'vt-1',
      stationId: 'urban-radio',
      recordedBy: 'user-9',
      storageKey: 'stations/urban-radio/voice-tracks/vt-1.mp3',
      durationMs: 12000,
      transcript: 'Hello listeners',
      targetClockSlotId: 'slot-1',
      status: 'ready',
      aiGenerated: 1,
    });
    expect(sql).toMatch(/INSERT INTO voice_tracks/);
    expect(sql).toMatch(/id, station_id, recorded_by, storage_key, duration_ms, transcript, target_clock_slot_id, status, ai_generated, created_at/);
    expect(params[0]).toBe('vt-1');
    expect(params[1]).toBe('urban-radio');
    expect(params[2]).toBe('user-9');
    expect(params[3]).toBe('stations/urban-radio/voice-tracks/vt-1.mp3');
    expect(params[4]).toBe(12000);
    expect(params[5]).toBe('Hello listeners');
    expect(params[6]).toBe('slot-1');
    expect(params[7]).toBe('ready');
    expect(params[8]).toBe(1);
  });

  test('rejects invalid status', () => {
    expect(() =>
      buildVoiceTrackInsert({
        id: 'vt-1',
        stationId: 's',
        recordedBy: null,
        storageKey: 'k',
        durationMs: 1,
        transcript: null,
        targetClockSlotId: null,
        status: 'bogus' as unknown as 'draft',
        aiGenerated: 0,
      }),
    ).toThrow(/status/);
  });
});

describe('buildVoiceTrackUpdate', () => {
  test('given empty patch > throws', () => {
    expect(() => buildVoiceTrackUpdate('s', 'vt-1', {})).toThrow();
  });

  test('given transcript patch > only updates transcript field', () => {
    const { sql, params } = buildVoiceTrackUpdate('s', 'vt-1', {
      transcript: 'updated text',
    });
    expect(sql).toMatch(/UPDATE voice_tracks/);
    expect(sql).toMatch(/SET transcript = \?/);
    expect(sql).not.toMatch(/status = \?/);
    expect(sql).toMatch(/WHERE station_id = \? AND id = \?/);
    // params: transcript, stationId, id
    expect(params).toEqual(['updated text', 's', 'vt-1']);
  });

  test('given multi-field patch > updates each column', () => {
    const { sql, params } = buildVoiceTrackUpdate('s', 'vt-1', {
      transcript: 't',
      status: 'aired',
      targetClockSlotId: 'slot-2',
      aiGenerated: 1,
    });
    expect(sql).toMatch(/transcript = \?/);
    expect(sql).toMatch(/status = \?/);
    expect(sql).toMatch(/target_clock_slot_id = \?/);
    expect(sql).toMatch(/ai_generated = \?/);
    expect(params).toContain('t');
    expect(params).toContain('aired');
    expect(params).toContain('slot-2');
    expect(params).toContain(1);
    expect(params).toContain('s');
    expect(params).toContain('vt-1');
  });

  test('given invalid status > throws', () => {
    expect(() =>
      buildVoiceTrackUpdate('s', 'vt-1', {
        status: 'bogus' as unknown as 'draft',
      }),
    ).toThrow(/status/);
  });

  test('allows clearing transcript/targetClockSlotId to null', () => {
    const { sql, params } = buildVoiceTrackUpdate('s', 'vt-1', {
      transcript: null,
      targetClockSlotId: null,
    });
    expect(sql).toMatch(/transcript = \?/);
    expect(sql).toMatch(/target_clock_slot_id = \?/);
    expect(params).toContain(null);
  });
});

describe('buildVoiceTrackDelete', () => {
  test('scopes station_id and id', () => {
    const { sql, params } = buildVoiceTrackDelete('urban-radio', 'vt-1');
    expect(sql).toMatch(/DELETE FROM voice_tracks/);
    expect(sql).toMatch(/WHERE station_id = \? AND id = \?/);
    expect(params).toEqual(['urban-radio', 'vt-1']);
  });

  test('given missing stationId or id > throws', () => {
    expect(() => buildVoiceTrackDelete('', 'vt-1')).toThrow();
    expect(() => buildVoiceTrackDelete('s', '')).toThrow();
  });
});

describe('VT_STATUSES', () => {
  test('matches migration 0004 CHECK constraint', () => {
    expect(VT_STATUSES).toEqual(['draft', 'ready', 'aired', 'archived']);
  });
});
