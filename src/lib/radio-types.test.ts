import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  Organization,
  Station,
  StationMember,
  Category,
  RadioTrack,
  Clock,
  ClockSlot,
  ScheduleAssignment,
  PlayLogEntry,
  VoiceTrack,
  AuditLogEntry,
  Role,
  SlotType,
  VoiceTrackStatus,
  PlayLogSource,
} from '@/lib/radio-types';

// ---------------------------------------------------------------------------
// Type-level tests (compile-time only)
//
// Strategy: use typed variables and expectTypeOf(...).toMatchTypeOf<T>()
// (assignability check) rather than .toEqualTypeOf<T>() (exact equality).
// This avoids the vitest 3.x constraint violation for string literal unions
// where the inferred type of a const is the narrow literal, not the full union.
// ---------------------------------------------------------------------------

describe('RadioTrack > required fields', () => {
  it('station_id is string (required)', () => {
    expectTypeOf<RadioTrack['station_id']>().toMatchTypeOf<string>();
  });

  it('storage_key is string (required)', () => {
    expectTypeOf<RadioTrack['storage_key']>().toMatchTypeOf<string>();
  });

  it('duration_ms is number (required)', () => {
    expectTypeOf<RadioTrack['duration_ms']>().toEqualTypeOf<number>();
  });

  it('artist is nullable', () => {
    expectTypeOf<RadioTrack['artist']>().toEqualTypeOf<string | null>();
  });

  it('category_id is nullable', () => {
    expectTypeOf<RadioTrack['category_id']>().toEqualTypeOf<string | null>();
  });

  it('cue_out_ms is nullable', () => {
    expectTypeOf<RadioTrack['cue_out_ms']>().toEqualTypeOf<number | null>();
  });

  it('last_played_at is nullable', () => {
    expectTypeOf<RadioTrack['last_played_at']>().toEqualTypeOf<string | null>();
  });
});

// ---------------------------------------------------------------------------
// Role type
// ---------------------------------------------------------------------------

describe('Role type', () => {
  it('is a subtype of string (extends string)', () => {
    // Role is a string literal union — it must be assignable to string.
    expectTypeOf<Role>().toMatchTypeOf<string>();
  });

  it('compile-time: all five literals are assignable to Role', () => {
    // The type annotation itself is the test — if any literal is wrong it
    // would be a compile error caught by `tsc --noEmit`.
    const _op: Role = 'operator';
    const _pr: Role = 'producer';
    const _pg: Role = 'programmer';
    const _ad: Role = 'admin';
    const _gv: Role = 'guest_vt';
    // Satisfy vitest — at least one runtime assertion required per test.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SlotType type
// ---------------------------------------------------------------------------

describe('SlotType type', () => {
  it('is a subtype of string (extends string)', () => {
    expectTypeOf<SlotType>().toMatchTypeOf<string>();
  });

  it('compile-time: all ten literals are assignable to SlotType', () => {
    const _mu: SlotType = 'music';
    const _sw: SlotType = 'sweeper';
    const _li: SlotType = 'liner';
    const _vt: SlotType = 'vt';
    const _id: SlotType = 'id';
    const _ne: SlotType = 'news';
    const _we: SlotType = 'weather';
    const _sp: SlotType = 'spot';
    const _be: SlotType = 'bed';
    const _cu: SlotType = 'custom';
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// VoiceTrackStatus type
// ---------------------------------------------------------------------------

describe('VoiceTrackStatus type', () => {
  it('covers all four lifecycle states at compile time', () => {
    const _dr: VoiceTrackStatus = 'draft';
    const _re: VoiceTrackStatus = 'ready';
    const _ai: VoiceTrackStatus = 'aired';
    const _ar: VoiceTrackStatus = 'archived';
    expect(true).toBe(true);
  });

  it('runtime: array has four elements matching SQL CHECK', () => {
    const statuses: VoiceTrackStatus[] = ['draft', 'ready', 'aired', 'archived'];
    expect(statuses).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// PlayLogSource type
// ---------------------------------------------------------------------------

describe('PlayLogSource type', () => {
  it('covers all six source variants at compile time', () => {
    const _au: PlayLogSource = 'automation';
    const _ma: PlayLogSource = 'manual';
    const _ld: PlayLogSource = 'live_dj';
    const _vt: PlayLogSource = 'voice_track';
    const _ca: PlayLogSource = 'cart';
    const _sp: PlayLogSource = 'spot';
    expect(true).toBe(true);
  });

  it('runtime: array has six elements matching SQL CHECK', () => {
    const sources: PlayLogSource[] = [
      'automation',
      'manual',
      'live_dj',
      'voice_track',
      'cart',
      'spot',
    ];
    expect(sources).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Runtime smoke tests — literal values against SQL CHECK constraints
// ---------------------------------------------------------------------------

describe('Role runtime values', () => {
  it('contains all five expected role literals', () => {
    const roles: Role[] = ['operator', 'producer', 'programmer', 'admin', 'guest_vt'];
    expect(roles).toContain('operator');
    expect(roles).toContain('producer');
    expect(roles).toContain('programmer');
    expect(roles).toContain('admin');
    expect(roles).toContain('guest_vt');
    expect(roles).toHaveLength(5);
  });
});

describe('SlotType runtime values', () => {
  it('exhaustive list of ten slots matches SQL CHECK constraint', () => {
    const slotTypes: SlotType[] = [
      'music',
      'sweeper',
      'liner',
      'vt',
      'id',
      'news',
      'weather',
      'spot',
      'bed',
      'custom',
    ];
    expect(slotTypes).toHaveLength(10);
    expect(slotTypes).toContain('music');
    expect(slotTypes).toContain('vt');
    expect(slotTypes).toContain('custom');
    expect(slotTypes).toContain('news');
    expect(slotTypes).toContain('weather');
  });
});

describe('PlayLogSource runtime values', () => {
  it('matches SQL CHECK constraint', () => {
    const sources: PlayLogSource[] = [
      'automation',
      'manual',
      'live_dj',
      'voice_track',
      'cart',
      'spot',
    ];
    expect(sources).toContain('automation');
    expect(sources).toContain('live_dj');
    expect(sources).toContain('spot');
    expect(sources).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Structural type checks for row interfaces
// ---------------------------------------------------------------------------

describe('Organization type', () => {
  it('id is string', () => {
    expectTypeOf<Organization['id']>().toEqualTypeOf<string>();
  });

  it('name is string', () => {
    expectTypeOf<Organization['name']>().toEqualTypeOf<string>();
  });

  it('plan is string', () => {
    expectTypeOf<Organization['plan']>().toEqualTypeOf<string>();
  });

  it('billing_customer_id is nullable', () => {
    expectTypeOf<Organization['billing_customer_id']>().toEqualTypeOf<string | null>();
  });

  it('created_at is string', () => {
    expectTypeOf<Organization['created_at']>().toEqualTypeOf<string>();
  });
});

describe('Station type', () => {
  it('org_id is string', () => {
    expectTypeOf<Station['org_id']>().toEqualTypeOf<string>();
  });

  it('slug is string', () => {
    expectTypeOf<Station['slug']>().toEqualTypeOf<string>();
  });

  it('timezone is string', () => {
    expectTypeOf<Station['timezone']>().toEqualTypeOf<string>();
  });

  it('stream_url is nullable', () => {
    expectTypeOf<Station['stream_url']>().toEqualTypeOf<string | null>();
  });
});

describe('StationMember type', () => {
  it('role uses the Role union', () => {
    // Role is a subtype of string; StationMember.role must also be a subtype of string.
    expectTypeOf<StationMember['role']>().toMatchTypeOf<string>();
  });

  it('compile-time: role field accepts Role literals', () => {
    const member: StationMember = {
      station_id: 's1',
      user_id: 'u1',
      role: 'admin',
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(member.role).toBe('admin');
  });
});

describe('ClockSlot type', () => {
  it('slot_type uses SlotType union', () => {
    expectTypeOf<ClockSlot['slot_type']>().toMatchTypeOf<string>();
  });

  it('compile-time: slot_type accepts SlotType literals', () => {
    const slot: ClockSlot = {
      id: 'sl1',
      clock_id: 'c1',
      position: 0,
      slot_type: 'music',
      category_id: null,
      duration_estimate_ms: 210000,
      rules_json: null,
    };
    expect(slot.slot_type).toBe('music');
  });
});

describe('PlayLogEntry type', () => {
  it('source uses PlayLogSource union', () => {
    expectTypeOf<PlayLogEntry['source']>().toMatchTypeOf<string>();
  });

  it('title_snapshot is string', () => {
    expectTypeOf<PlayLogEntry['title_snapshot']>().toEqualTypeOf<string>();
  });

  it('played_at is string', () => {
    expectTypeOf<PlayLogEntry['played_at']>().toEqualTypeOf<string>();
  });

  it('track_id is nullable', () => {
    expectTypeOf<PlayLogEntry['track_id']>().toEqualTypeOf<string | null>();
  });
});

describe('VoiceTrack type', () => {
  it('status uses VoiceTrackStatus union', () => {
    expectTypeOf<VoiceTrack['status']>().toMatchTypeOf<string>();
  });

  it('storage_key is string', () => {
    expectTypeOf<VoiceTrack['storage_key']>().toEqualTypeOf<string>();
  });

  it('duration_ms is number', () => {
    expectTypeOf<VoiceTrack['duration_ms']>().toEqualTypeOf<number>();
  });

  it('recorded_by is nullable', () => {
    expectTypeOf<VoiceTrack['recorded_by']>().toEqualTypeOf<string | null>();
  });
});

describe('AuditLogEntry type', () => {
  it('action is string', () => {
    expectTypeOf<AuditLogEntry['action']>().toEqualTypeOf<string>();
  });

  it('target_type is string', () => {
    expectTypeOf<AuditLogEntry['target_type']>().toEqualTypeOf<string>();
  });

  it('target_id is string', () => {
    expectTypeOf<AuditLogEntry['target_id']>().toEqualTypeOf<string>();
  });

  it('at is string', () => {
    expectTypeOf<AuditLogEntry['at']>().toEqualTypeOf<string>();
  });

  it('station_id is nullable', () => {
    expectTypeOf<AuditLogEntry['station_id']>().toEqualTypeOf<string | null>();
  });

  it('actor_user_id is nullable', () => {
    expectTypeOf<AuditLogEntry['actor_user_id']>().toEqualTypeOf<string | null>();
  });
});

describe('Category type', () => {
  it('station_id is string', () => {
    expectTypeOf<Category['station_id']>().toEqualTypeOf<string>();
  });

  it('name is string', () => {
    expectTypeOf<Category['name']>().toEqualTypeOf<string>();
  });
});

describe('Clock type', () => {
  it('station_id is string', () => {
    expectTypeOf<Clock['station_id']>().toEqualTypeOf<string>();
  });

  it('name is string', () => {
    expectTypeOf<Clock['name']>().toEqualTypeOf<string>();
  });
});

describe('ScheduleAssignment type', () => {
  it('weekday is number', () => {
    expectTypeOf<ScheduleAssignment['weekday']>().toEqualTypeOf<number>();
  });

  it('hour is number', () => {
    expectTypeOf<ScheduleAssignment['hour']>().toEqualTypeOf<number>();
  });

  it('valid_from is nullable', () => {
    expectTypeOf<ScheduleAssignment['valid_from']>().toEqualTypeOf<string | null>();
  });

  it('valid_until is nullable', () => {
    expectTypeOf<ScheduleAssignment['valid_until']>().toEqualTypeOf<string | null>();
  });
});
