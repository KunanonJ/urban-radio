import { describe, test, expect } from 'vitest';
import {
  buildCommentsListQuery,
  buildCommentInsert,
  buildCommentUpdate,
  buildCommentDelete,
  buildCommentByIdQuery,
  COMMENT_TARGET_TYPES,
  isCommentTargetType,
  clampLimit,
  encodeCursor,
  decodeCursor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type CommentRow,
} from './comment-queries';

describe('clampLimit', () => {
  test('given undefined > uses default', () => {
    expect(clampLimit(undefined, MAX_LIMIT, DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
  });

  test('given value > max > clamps to max', () => {
    expect(clampLimit(9999, MAX_LIMIT, DEFAULT_LIMIT)).toBe(MAX_LIMIT);
  });

  test('given 0 or negative > returns default', () => {
    expect(clampLimit(0, MAX_LIMIT, DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
    expect(clampLimit(-3, MAX_LIMIT, DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
  });

  test('given a valid mid-range value > returns it', () => {
    expect(clampLimit(25, MAX_LIMIT, DEFAULT_LIMIT)).toBe(25);
  });
});

describe('isCommentTargetType', () => {
  test('returns true for each canonical target type', () => {
    for (const t of COMMENT_TARGET_TYPES) {
      expect(isCommentTargetType(t)).toBe(true);
    }
  });

  test('returns false for unknown values', () => {
    expect(isCommentTargetType('mystery')).toBe(false);
    expect(isCommentTargetType(null)).toBe(false);
    expect(isCommentTargetType(undefined)).toBe(false);
    expect(isCommentTargetType(42)).toBe(false);
  });
});

describe('encodeCursor / decodeCursor', () => {
  test('round-trips a well-formed cursor', () => {
    const c = { lastCreatedAt: '2026-05-14T10:00:00Z', lastId: 'c-1' };
    const decoded = decodeCursor(encodeCursor(c));
    expect(decoded).toEqual(c);
  });

  test('returns null for null/empty input', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  test('returns null for malformed cursor', () => {
    expect(decodeCursor('not-base64-!!')).toBeNull();
  });
});

describe('buildCommentsListQuery', () => {
  test('scopes station_id as the first WHERE predicate', () => {
    const { sql, params } = buildCommentsListQuery({
      stationId: 'urban-radio',
      targetType: 'clock',
      targetId: 'clk-1',
      limit: 50,
    });
    expect(sql).toMatch(/FROM comments/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
    expect(params).toContain('clock');
    expect(params).toContain('clk-1');
  });

  test('orders by created_at DESC, id DESC for keyset stability', () => {
    const { sql } = buildCommentsListQuery({
      stationId: 's',
      targetType: 'voice_track',
      targetId: 'vt-1',
      limit: 50,
    });
    expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/);
  });

  test('includeResolved=false (default) excludes resolved rows', () => {
    const { sql } = buildCommentsListQuery({
      stationId: 's',
      targetType: 'clock',
      targetId: 'clk-1',
      limit: 50,
    });
    expect(sql).toMatch(/resolved_at IS NULL/);
  });

  test('includeResolved=true does not add the resolved filter', () => {
    const { sql } = buildCommentsListQuery({
      stationId: 's',
      targetType: 'clock',
      targetId: 'clk-1',
      includeResolved: true,
      limit: 50,
    });
    expect(sql).not.toMatch(/resolved_at IS NULL/);
  });

  test('given cursor > adds keyset WHERE (created_at, id) < (?, ?)', () => {
    const { sql, params } = buildCommentsListQuery({
      stationId: 's',
      targetType: 'clock',
      targetId: 'clk-1',
      cursor: { lastCreatedAt: '2026-05-14T10:00:00Z', lastId: 'c-9' },
      limit: 50,
    });
    expect(sql).toMatch(/\(created_at, id\) < \(\?, \?\)/);
    expect(params).toContain('2026-05-14T10:00:00Z');
    expect(params).toContain('c-9');
  });

  test('clamps limit > MAX_LIMIT into SQL', () => {
    const { sql } = buildCommentsListQuery({
      stationId: 's',
      targetType: 'clock',
      targetId: 'clk-1',
      limit: 9999,
    });
    expect(sql).toMatch(new RegExp(`LIMIT ${MAX_LIMIT}`));
  });

  test('rejects unknown target_type', () => {
    expect(() =>
      buildCommentsListQuery({
        stationId: 's',
        targetType: 'mystery' as unknown as 'clock',
        targetId: 'x',
        limit: 50,
      }),
    ).toThrow(/target_type/);
  });

  test('rejects missing stationId', () => {
    expect(() =>
      buildCommentsListQuery({
        stationId: '',
        targetType: 'clock',
        targetId: 'x',
        limit: 50,
      }),
    ).toThrow();
  });
});

describe('buildCommentByIdQuery', () => {
  test('selects station-scoped row by id', () => {
    const { sql, params } = buildCommentByIdQuery('s', 'c-1');
    expect(sql).toMatch(/FROM comments/);
    expect(sql).toMatch(/WHERE station_id = \? AND id = \?/);
    expect(params).toEqual(['s', 'c-1']);
  });

  test('rejects missing args', () => {
    expect(() => buildCommentByIdQuery('', 'c-1')).toThrow();
    expect(() => buildCommentByIdQuery('s', '')).toThrow();
  });
});

describe('buildCommentInsert', () => {
  test('rejects empty body', () => {
    const row: Omit<CommentRow, 'createdAt' | 'updatedAt'> = {
      id: 'c-1',
      stationId: 's',
      authorUserId: 'u-1',
      targetType: 'clock',
      targetId: 'clk-1',
      body: '',
      resolvedAt: null,
      resolvedByUserId: null,
    };
    expect(() => buildCommentInsert(row)).toThrow(/body/);
  });

  test('rejects body over 2000 chars', () => {
    const row: Omit<CommentRow, 'createdAt' | 'updatedAt'> = {
      id: 'c-1',
      stationId: 's',
      authorUserId: 'u-1',
      targetType: 'clock',
      targetId: 'clk-1',
      body: 'x'.repeat(2001),
      resolvedAt: null,
      resolvedByUserId: null,
    };
    expect(() => buildCommentInsert(row)).toThrow(/body/);
  });

  test('rejects unknown target_type', () => {
    const row = {
      id: 'c-1',
      stationId: 's',
      authorUserId: 'u-1',
      targetType: 'mystery' as unknown as 'clock',
      targetId: 'clk-1',
      body: 'hi',
      resolvedAt: null,
      resolvedByUserId: null,
    };
    expect(() => buildCommentInsert(row)).toThrow(/target_type/);
  });

  test('builds INSERT with bind order matching column list', () => {
    const { sql, params } = buildCommentInsert({
      id: 'c-1',
      stationId: 'urban-radio',
      authorUserId: 'u-1',
      targetType: 'voice_track',
      targetId: 'vt-1',
      body: 'great take',
      resolvedAt: null,
      resolvedByUserId: null,
    });
    expect(sql).toMatch(/INSERT INTO comments/);
    expect(sql).toMatch(
      /\(id, station_id, author_user_id, target_type, target_id, body, resolved_at, resolved_by_user_id, created_at, updated_at\)/,
    );
    expect(params).toEqual([
      'c-1',
      'urban-radio',
      'u-1',
      'voice_track',
      'vt-1',
      'great take',
      null,
      null,
    ]);
  });
});

describe('buildCommentUpdate', () => {
  test('rejects empty patch', () => {
    expect(() => buildCommentUpdate('s', 'c-1', {})).toThrow();
  });

  test('given body patch > only updates body + updated_at', () => {
    const { sql, params } = buildCommentUpdate('s', 'c-1', { body: 'edited' });
    expect(sql).toMatch(/UPDATE comments/);
    expect(sql).toMatch(/SET body = \?/);
    expect(sql).toMatch(/updated_at = datetime\('now'\)/);
    expect(sql).toMatch(/WHERE station_id = \? AND id = \?/);
    // params: body, station, id (no separate updated_at value — inlined SQL)
    expect(params).toEqual(['edited', 's', 'c-1']);
  });

  test('given resolvedAt + resolvedByUserId patch > sets both fields', () => {
    const { sql, params } = buildCommentUpdate('s', 'c-1', {
      resolvedAt: '2026-05-14T12:00:00Z',
      resolvedByUserId: 'u-9',
    });
    expect(sql).toMatch(/resolved_at = \?/);
    expect(sql).toMatch(/resolved_by_user_id = \?/);
    expect(params).toContain('2026-05-14T12:00:00Z');
    expect(params).toContain('u-9');
  });

  test('allows clearing resolved fields to null', () => {
    const { sql, params } = buildCommentUpdate('s', 'c-1', {
      resolvedAt: null,
      resolvedByUserId: null,
    });
    expect(sql).toMatch(/resolved_at = \?/);
    expect(sql).toMatch(/resolved_by_user_id = \?/);
    expect(params).toContain(null);
  });

  test('rejects body over 2000 chars', () => {
    expect(() =>
      buildCommentUpdate('s', 'c-1', { body: 'x'.repeat(2001) }),
    ).toThrow(/body/);
  });
});

describe('buildCommentDelete', () => {
  test('scopes station_id + id', () => {
    const { sql, params } = buildCommentDelete('urban-radio', 'c-1');
    expect(sql).toMatch(/DELETE FROM comments/);
    expect(sql).toMatch(/WHERE station_id = \? AND id = \?/);
    expect(params).toEqual(['urban-radio', 'c-1']);
  });

  test('rejects missing args', () => {
    expect(() => buildCommentDelete('', 'c-1')).toThrow();
    expect(() => buildCommentDelete('s', '')).toThrow();
  });
});

describe('COMMENT_TARGET_TYPES', () => {
  test('mirrors migration 0007 CHECK constraint', () => {
    expect(COMMENT_TARGET_TYPES).toEqual([
      'clock',
      'clock_slot',
      'schedule_assignment',
      'voice_track',
      'radio_track',
    ]);
  });
});
