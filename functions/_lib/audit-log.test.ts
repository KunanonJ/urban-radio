import { describe, test, expect, vi, beforeEach } from 'vitest';
import { writeAuditLog } from './audit-log';

type Bind = unknown;

function buildD1Mock(opts: { prepareThrows?: boolean; runThrows?: boolean } = {}) {
  const captured: { sql: string; binds: Bind[] } = { sql: '', binds: [] };
  const runFn = vi.fn(() => {
    if (opts.runThrows) throw new Error('run failed');
    return Promise.resolve({ success: true });
  });
  const prepare = vi.fn((sql: string) => {
    if (opts.prepareThrows) throw new Error('prepare failed');
    captured.sql = sql;
    return {
      bind: (...args: Bind[]) => {
        captured.binds = args;
        return { run: runFn };
      },
    };
  });
  return { prepare, runFn, captured };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('writeAuditLog', () => {
  test('given valid entry > calls prepare with INSERT INTO audit_log', async () => {
    const mock = buildD1Mock();
    const db = { prepare: mock.prepare } as unknown as D1Database;
    await writeAuditLog(db, {
      stationId: 'urban-radio',
      actorUserId: 'user-1',
      action: 'create',
      targetType: 'clock',
      targetId: 'clock-1',
    });
    expect(mock.prepare).toHaveBeenCalledTimes(1);
    expect(mock.captured.sql).toMatch(/INSERT INTO audit_log/i);
    expect(mock.runFn).toHaveBeenCalledTimes(1);
  });

  test('given prepare throws > does not propagate the error', async () => {
    const mock = buildD1Mock({ prepareThrows: true });
    const db = { prepare: mock.prepare } as unknown as D1Database;
    await expect(
      writeAuditLog(db, {
        stationId: 'urban-radio',
        actorUserId: 'user-1',
        action: 'create',
        targetType: 'clock',
        targetId: 'clock-1',
      }),
    ).resolves.toBeUndefined();
  });

  test('given run throws > does not propagate the error', async () => {
    const mock = buildD1Mock({ runThrows: true });
    const db = { prepare: mock.prepare } as unknown as D1Database;
    await expect(
      writeAuditLog(db, {
        stationId: 'urban-radio',
        actorUserId: 'user-1',
        action: 'update',
        targetType: 'clock',
        targetId: 'clock-1',
      }),
    ).resolves.toBeUndefined();
  });

  test('given before/after objects > JSON-stringifies them', async () => {
    const mock = buildD1Mock();
    const db = { prepare: mock.prepare } as unknown as D1Database;
    const before = { name: 'A' };
    const after = { name: 'B' };
    await writeAuditLog(db, {
      stationId: 'urban-radio',
      actorUserId: 'user-1',
      action: 'update',
      targetType: 'clock',
      targetId: 'clock-1',
      before,
      after,
    });
    expect(mock.captured.binds).toContain(JSON.stringify(before));
    expect(mock.captured.binds).toContain(JSON.stringify(after));
  });

  test('given no before/after > binds nulls', async () => {
    const mock = buildD1Mock();
    const db = { prepare: mock.prepare } as unknown as D1Database;
    await writeAuditLog(db, {
      stationId: 'urban-radio',
      actorUserId: 'user-1',
      action: 'delete',
      targetType: 'clock',
      targetId: 'clock-1',
    });
    // before_json and after_json are the 7th and 8th positional binds:
    // (id, station_id, actor_user_id, action, target_type, target_id, before_json, after_json)
    expect(mock.captured.binds[6]).toBeNull();
    expect(mock.captured.binds[7]).toBeNull();
  });

  test('binds station_id, actor_user_id, action, target_type, target_id in expected positions', async () => {
    const mock = buildD1Mock();
    const db = { prepare: mock.prepare } as unknown as D1Database;
    await writeAuditLog(db, {
      stationId: 'urban-radio',
      actorUserId: 'user-1',
      action: 'create',
      targetType: 'clock_slot',
      targetId: 'slot-9',
    });
    // [0] = id (uuid), [1] = station_id, [2] = actor_user_id, [3] = action, [4] = target_type, [5] = target_id
    expect(typeof mock.captured.binds[0]).toBe('string');
    expect(mock.captured.binds[1]).toBe('urban-radio');
    expect(mock.captured.binds[2]).toBe('user-1');
    expect(mock.captured.binds[3]).toBe('create');
    expect(mock.captured.binds[4]).toBe('clock_slot');
    expect(mock.captured.binds[5]).toBe('slot-9');
  });
});
