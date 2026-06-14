import { describe, test, expect } from 'vitest';
import {
  buildPresenceUpsert,
  buildPresenceListActive,
  buildPresenceCleanup,
  isPresenceTargetType,
  PRESENCE_TARGET_TYPES,
  PRESENCE_TTL_SECONDS,
  PRESENCE_MAX_TTL_SECONDS,
} from './presence-queries';

describe('PRESENCE_TARGET_TYPES', () => {
  test('mirrors migration 0008 CHECK constraint (6 types)', () => {
    expect(PRESENCE_TARGET_TYPES).toEqual([
      'clock',
      'clock_slot',
      'schedule_assignment',
      'voice_track',
      'radio_track',
      'schedule_cell',
    ]);
  });
});

describe('isPresenceTargetType', () => {
  test('accepts every canonical value', () => {
    for (const t of PRESENCE_TARGET_TYPES) {
      expect(isPresenceTargetType(t)).toBe(true);
    }
  });

  test('rejects unknowns', () => {
    expect(isPresenceTargetType('mystery')).toBe(false);
    expect(isPresenceTargetType(null)).toBe(false);
    expect(isPresenceTargetType(undefined)).toBe(false);
    expect(isPresenceTargetType(7)).toBe(false);
  });
});

describe('buildPresenceUpsert', () => {
  test('emits INSERT … ON CONFLICT DO UPDATE on the unique index columns', () => {
    const { sql, params } = buildPresenceUpsert({
      id: 'p-1',
      stationId: 'urban-radio',
      userId: 'user-1',
      targetType: 'clock',
      targetId: 'clk-1',
    });
    expect(sql).toMatch(/INSERT INTO presence_sessions/);
    expect(sql).toMatch(/ON CONFLICT\(station_id, user_id, target_type, target_id\)/);
    expect(sql).toMatch(/DO UPDATE SET\s+last_heartbeat_at = datetime\('now'\)/);
    expect(params).toEqual(['p-1', 'urban-radio', 'user-1', 'clock', 'clk-1']);
  });

  test('writes UTC datetime("now") for both timestamps on insert', () => {
    const { sql } = buildPresenceUpsert({
      id: 'p-1',
      stationId: 's',
      userId: 'u',
      targetType: 'clock',
      targetId: 'x',
    });
    // VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    expect(sql).toMatch(/VALUES \(\?, \?, \?, \?, \?, datetime\('now'\), datetime\('now'\)\)/);
  });

  test('rejects missing stationId / userId / id / targetId', () => {
    const base = {
      id: 'p-1',
      stationId: 's',
      userId: 'u',
      targetType: 'clock' as const,
      targetId: 'x',
    };
    expect(() => buildPresenceUpsert({ ...base, id: '' })).toThrow();
    expect(() => buildPresenceUpsert({ ...base, stationId: '' })).toThrow();
    expect(() => buildPresenceUpsert({ ...base, userId: '' })).toThrow();
    expect(() => buildPresenceUpsert({ ...base, targetId: '' })).toThrow();
  });

  test('rejects unknown target_type', () => {
    expect(() =>
      buildPresenceUpsert({
        id: 'p-1',
        stationId: 's',
        userId: 'u',
        targetType: 'mystery' as unknown as 'clock',
        targetId: 'x',
      }),
    ).toThrow(/target_type/);
  });

  test('accepts every canonical target_type', () => {
    for (const t of PRESENCE_TARGET_TYPES) {
      expect(() =>
        buildPresenceUpsert({
          id: 'p',
          stationId: 's',
          userId: 'u',
          targetType: t,
          targetId: 'x',
        }),
      ).not.toThrow();
    }
  });
});

describe('buildPresenceListActive', () => {
  test('scopes station_id, target_type, target_id and JOINs auth_users', () => {
    const { sql, params } = buildPresenceListActive({
      stationId: 'urban-radio',
      targetType: 'clock_slot',
      targetId: 'slot-9',
    });
    expect(sql).toMatch(/FROM presence_sessions p/);
    expect(sql).toMatch(/LEFT JOIN auth_users u ON u\.id = p\.user_id/);
    expect(sql).toMatch(/WHERE p\.station_id = \?/);
    expect(sql).toMatch(/AND p\.target_type = \?/);
    expect(sql).toMatch(/AND p\.target_id = \?/);
    expect(params).toEqual(['urban-radio', 'clock_slot', 'slot-9']);
  });

  test('applies UTC TTL window using datetime("now", "-N seconds")', () => {
    const { sql } = buildPresenceListActive({
      stationId: 's',
      targetType: 'clock',
      targetId: 'x',
    });
    expect(sql).toMatch(
      new RegExp(`datetime\\('now', '-${PRESENCE_TTL_SECONDS} seconds'\\)`),
    );
  });

  test('honors a custom ttlSeconds override', () => {
    const { sql } = buildPresenceListActive({
      stationId: 's',
      targetType: 'clock',
      targetId: 'x',
      ttlSeconds: 60,
    });
    expect(sql).toMatch(/datetime\('now', '-60 seconds'\)/);
  });

  test('clamps non-positive ttlSeconds back to default', () => {
    const { sql } = buildPresenceListActive({
      stationId: 's',
      targetType: 'clock',
      targetId: 'x',
      ttlSeconds: 0,
    });
    expect(sql).toMatch(
      new RegExp(`datetime\\('now', '-${PRESENCE_TTL_SECONDS} seconds'\\)`),
    );
  });

  test('clamps oversized ttlSeconds to PRESENCE_MAX_TTL_SECONDS', () => {
    const { sql } = buildPresenceListActive({
      stationId: 's',
      targetType: 'clock',
      targetId: 'x',
      ttlSeconds: 999999,
    });
    expect(sql).toMatch(
      new RegExp(`datetime\\('now', '-${PRESENCE_MAX_TTL_SECONDS} seconds'\\)`),
    );
  });

  test('orders by last_heartbeat_at DESC for stable avatar stack', () => {
    const { sql } = buildPresenceListActive({
      stationId: 's',
      targetType: 'clock',
      targetId: 'x',
    });
    expect(sql).toMatch(/ORDER BY p\.last_heartbeat_at DESC, p\.id DESC/);
  });

  test('rejects unknown target_type', () => {
    expect(() =>
      buildPresenceListActive({
        stationId: 's',
        targetType: 'mystery' as unknown as 'clock',
        targetId: 'x',
      }),
    ).toThrow(/target_type/);
  });

  test('rejects empty stationId / targetId', () => {
    expect(() =>
      buildPresenceListActive({
        stationId: '',
        targetType: 'clock',
        targetId: 'x',
      }),
    ).toThrow();
    expect(() =>
      buildPresenceListActive({
        stationId: 's',
        targetType: 'clock',
        targetId: '',
      }),
    ).toThrow();
  });
});

describe('buildPresenceCleanup', () => {
  test('emits a DELETE WHERE last_heartbeat_at < datetime("now", "-N seconds")', () => {
    const { sql, params } = buildPresenceCleanup(15);
    expect(sql).toMatch(/DELETE FROM presence_sessions/);
    expect(sql).toMatch(/last_heartbeat_at < datetime\('now', '-15 seconds'\)/);
    expect(params).toEqual([]);
  });

  test('falls back to default TTL on invalid input', () => {
    const { sql } = buildPresenceCleanup(0);
    expect(sql).toMatch(
      new RegExp(`datetime\\('now', '-${PRESENCE_TTL_SECONDS} seconds'\\)`),
    );
  });

  test('clamps oversized cleanup TTL', () => {
    const { sql } = buildPresenceCleanup(999_999);
    expect(sql).toMatch(
      new RegExp(`datetime\\('now', '-${PRESENCE_MAX_TTL_SECONDS} seconds'\\)`),
    );
  });
});
