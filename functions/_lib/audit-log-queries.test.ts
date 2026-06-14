import { describe, test, expect } from 'vitest';
import {
  buildAuditLogListQuery,
  buildAuditLogCsvQuery,
  clampLimit,
  encodeCursor,
  decodeCursor,
  AUDIT_LOG_DEFAULT_LIMIT,
  AUDIT_LOG_MAX_LIMIT,
} from './audit-log-queries';

describe('clampLimit (audit-log)', () => {
  test('given undefined > returns default', () => {
    expect(clampLimit(undefined, AUDIT_LOG_MAX_LIMIT, AUDIT_LOG_DEFAULT_LIMIT)).toBe(
      AUDIT_LOG_DEFAULT_LIMIT,
    );
  });

  test('given zero or negative > returns default', () => {
    expect(clampLimit(0, AUDIT_LOG_MAX_LIMIT, AUDIT_LOG_DEFAULT_LIMIT)).toBe(AUDIT_LOG_DEFAULT_LIMIT);
    expect(clampLimit(-3, AUDIT_LOG_MAX_LIMIT, AUDIT_LOG_DEFAULT_LIMIT)).toBe(AUDIT_LOG_DEFAULT_LIMIT);
  });

  test('given value > max > clamps to max', () => {
    expect(clampLimit(99_999, AUDIT_LOG_MAX_LIMIT, AUDIT_LOG_DEFAULT_LIMIT)).toBe(
      AUDIT_LOG_MAX_LIMIT,
    );
  });

  test('given valid value > returns it (floored)', () => {
    expect(clampLimit(75, AUDIT_LOG_MAX_LIMIT, AUDIT_LOG_DEFAULT_LIMIT)).toBe(75);
    expect(clampLimit(75.9, AUDIT_LOG_MAX_LIMIT, AUDIT_LOG_DEFAULT_LIMIT)).toBe(75);
  });
});

describe('encodeCursor / decodeCursor (audit-log)', () => {
  test('given valid cursor > round-trips', () => {
    const cursor = { lastAt: '2026-05-13T10:00:00Z', lastId: 'audit-1' };
    const encoded = encodeCursor(cursor);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  test('given undefined or null > returns null', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(undefined as unknown as string)).toBeNull();
  });

  test('given malformed input > returns null (does not throw)', () => {
    expect(decodeCursor('not-base64-!@#$')).toBeNull();
  });

  test('given object missing fields > returns null', () => {
    const partial = Buffer.from(JSON.stringify({ lastAt: 'x' }), 'utf8').toString('base64url');
    expect(decodeCursor(partial)).toBeNull();
  });
});

describe('buildAuditLogListQuery', () => {
  test('scopes station_id as the first predicate', () => {
    const { sql, params } = buildAuditLogListQuery({
      stationId: 'urban-radio',
      filters: {},
      limit: 50,
    });
    expect(sql).toMatch(/FROM audit_log/);
    expect(sql).toMatch(/WHERE/);
    // station_id should be the first bind parameter.
    expect(params[0]).toBe('urban-radio');
    expect(sql).toMatch(/station_id = \?/);
  });

  test('joins audit_log to auth_users via LEFT JOIN on actor_user_id', () => {
    const { sql } = buildAuditLogListQuery({
      stationId: 's',
      filters: {},
      limit: 50,
    });
    expect(sql).toMatch(/LEFT JOIN auth_users/i);
    // Surfaces actor.username (or null when user was deleted).
    expect(sql).toMatch(/auth_users/);
    expect(sql).toMatch(/actor_user_id/);
  });

  test('given actorUserId filter > adds actor_user_id = ?', () => {
    const { sql, params } = buildAuditLogListQuery({
      stationId: 's',
      filters: { actorUserId: 'user-99' },
      limit: 50,
    });
    expect(sql).toMatch(/actor_user_id = \?/);
    expect(params).toContain('user-99');
  });

  test('given action filter > adds action = ?', () => {
    const { sql, params } = buildAuditLogListQuery({
      stationId: 's',
      filters: { action: 'create' },
      limit: 50,
    });
    expect(sql).toMatch(/action = \?/);
    expect(params).toContain('create');
  });

  test('given targetType filter > adds target_type = ?', () => {
    const { sql, params } = buildAuditLogListQuery({
      stationId: 's',
      filters: { targetType: 'clock' },
      limit: 50,
    });
    expect(sql).toMatch(/target_type = \?/);
    expect(params).toContain('clock');
  });

  test('given from + to > adds at >= ? AND at < ?', () => {
    const { sql, params } = buildAuditLogListQuery({
      stationId: 's',
      filters: { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' },
      limit: 50,
    });
    expect(sql).toMatch(/at >= \?/);
    expect(sql).toMatch(/at < \?/);
    expect(params).toContain('2026-01-01T00:00:00Z');
    expect(params).toContain('2026-02-01T00:00:00Z');
  });

  test('given search > adds LIKE clause across before_json/after_json (case-insensitive via lower())', () => {
    const { sql, params } = buildAuditLogListQuery({
      stationId: 's',
      filters: { search: 'foo' },
      limit: 50,
    });
    // We expect a LIKE compound predicate.
    expect(sql).toMatch(/LIKE/i);
    // Both JSON columns must be considered so users find changes regardless of where the value sat.
    expect(sql).toMatch(/before_json/);
    expect(sql).toMatch(/after_json/);
    // We pass the wildcard-wrapped term to bind (do not inline into SQL).
    const wildcardish = params.find((p) => typeof p === 'string' && p.toString().toLowerCase().includes('foo'));
    expect(wildcardish).toBeDefined();
  });

  test('given cursor > adds keyset (at, id) < (?, ?)', () => {
    const { sql, params } = buildAuditLogListQuery({
      stationId: 's',
      filters: {},
      cursor: { lastAt: '2026-05-13T10:00:00Z', lastId: 'audit-1' },
      limit: 50,
    });
    // Accept either bare `(at, id)` or aliased `(a.at, a.id)` — the keyset
    // semantics are identical and the bind order is what matters.
    expect(sql).toMatch(/\(\s*(?:a\.)?at\s*,\s*(?:a\.)?id\s*\)\s*<\s*\(\?,\s*\?\)/);
    expect(params).toContain('2026-05-13T10:00:00Z');
    expect(params).toContain('audit-1');
  });

  test('orders by at DESC, id DESC for keyset stability', () => {
    const { sql } = buildAuditLogListQuery({
      stationId: 's',
      filters: {},
      limit: 50,
    });
    expect(sql).toMatch(/ORDER BY\s+(?:a\.)?at\s+DESC,\s+(?:a\.)?id\s+DESC/);
  });

  test('clamps limit > AUDIT_LOG_MAX_LIMIT into SQL', () => {
    const { sql } = buildAuditLogListQuery({
      stationId: 's',
      filters: {},
      limit: 9999,
    });
    expect(sql).toMatch(new RegExp(`LIMIT ${AUDIT_LOG_MAX_LIMIT}`));
  });

  test('given no stationId > throws', () => {
    expect(() =>
      buildAuditLogListQuery({ stationId: '', filters: {}, limit: 50 }),
    ).toThrow();
  });

  test('combines multiple filters into a single AND chain (no orphan params)', () => {
    const { sql, params } = buildAuditLogListQuery({
      stationId: 's',
      filters: {
        actorUserId: 'u',
        action: 'update',
        targetType: 'clock',
        from: '2026-01-01T00:00:00Z',
        to: '2026-02-01T00:00:00Z',
        search: 'morning',
      },
      limit: 50,
    });
    // Sanity: predicate count is ANDed.
    expect(sql).toMatch(/ AND /);
    // No bare LIKE 'foo' — value is bound.
    expect(sql.includes('morning')).toBe(false);
    expect(params).toContain('s');
    expect(params).toContain('u');
    expect(params).toContain('update');
    expect(params).toContain('clock');
  });
});

describe('buildAuditLogCsvQuery', () => {
  test('scopes station_id', () => {
    const { sql, params } = buildAuditLogCsvQuery({
      stationId: 'urban-radio',
      filters: {},
      rowCap: 50_000,
    });
    expect(sql).toMatch(/FROM audit_log/);
    expect(params[0]).toBe('urban-radio');
  });

  test('joins auth_users for actor username', () => {
    const { sql } = buildAuditLogCsvQuery({
      stationId: 's',
      filters: {},
      rowCap: 50_000,
    });
    expect(sql).toMatch(/LEFT JOIN auth_users/i);
  });

  test('uses rowCap + 1 to detect overflow without scanning whole table', () => {
    const { sql, params } = buildAuditLogCsvQuery({
      stationId: 's',
      filters: {},
      rowCap: 50_000,
    });
    // CSV path uses a parametric LIMIT bound from rowCap (+1 for overflow detection).
    expect(sql).toMatch(/LIMIT \?/);
    expect(params).toContain(50_001);
  });

  test('does not use a keyset cursor — CSV is one-shot', () => {
    const { sql } = buildAuditLogCsvQuery({
      stationId: 's',
      filters: {},
      rowCap: 50_000,
    });
    // No keyset cursor on CSV path.
    expect(sql.includes('(at, id) <')).toBe(false);
  });

  test('orders by at ASC, id ASC for deterministic exports', () => {
    const { sql } = buildAuditLogCsvQuery({
      stationId: 's',
      filters: {},
      rowCap: 50_000,
    });
    expect(sql).toMatch(/ORDER BY\s+(?:a\.)?at\s+ASC,\s+(?:a\.)?id\s+ASC/);
  });

  test('applies same filters as list query', () => {
    const { sql, params } = buildAuditLogCsvQuery({
      stationId: 's',
      filters: {
        actorUserId: 'u',
        action: 'royalty_export',
        targetType: 'station',
        from: '2026-01-01T00:00:00Z',
        to: '2026-02-01T00:00:00Z',
        search: 'ascap',
      },
      rowCap: 50_000,
    });
    expect(sql).toMatch(/actor_user_id = \?/);
    expect(sql).toMatch(/action = \?/);
    expect(sql).toMatch(/target_type = \?/);
    expect(sql).toMatch(/at >= \?/);
    expect(sql).toMatch(/at < \?/);
    expect(sql).toMatch(/LIKE/i);
    expect(params).toContain('u');
    expect(params).toContain('royalty_export');
    expect(params).toContain('station');
  });
});
