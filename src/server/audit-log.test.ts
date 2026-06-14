// @vitest-environment node

import { describe, expect, test } from 'vitest';

import { writeAuditLog } from './audit-log';
import { createTestDbWithUser } from './test-utils/db';

describe('writeAuditLog', () => {
  test('inserts a row with serialized before/after JSON', async () => {
    const { handle, user } = createTestDbWithUser();
    await writeAuditLog(
      handle.db,
      {
        stationId: user.stationId,
        actorUserId: user.userId,
        action: 'create',
        targetType: 'clock',
        targetId: 'clk-1',
        before: null,
        after: { name: 'Drive' },
      },
      { id: 'al-test-1', at: '2026-05-16T00:00:00Z' },
    );

    const rows = handle.mem.public.many(
      "SELECT * FROM audit_log WHERE id = 'al-test-1'",
    ) as Array<{
      id: string;
      action: string;
      target_type: string;
      after_json: string;
      before_json: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('create');
    expect(rows[0].target_type).toBe('clock');
    expect(rows[0].before_json).toBeNull();
    expect(JSON.parse(rows[0].after_json)).toEqual({ name: 'Drive' });
  });

  test('swallows errors so audit failures cannot abort the underlying mutation', async () => {
    const { handle, user } = createTestDbWithUser();
    // Insert once with a fixed id, then call again with the same id —
    // the duplicate PK violation must be swallowed.
    await writeAuditLog(
      handle.db,
      {
        stationId: user.stationId,
        actorUserId: user.userId,
        action: 'create',
        targetType: 'clock',
        targetId: 'clk-x',
      },
      { id: 'al-dup', at: '2026-05-16T00:00:00Z' },
    );

    // Second call with same id should NOT throw.
    await expect(
      writeAuditLog(
        handle.db,
        {
          stationId: user.stationId,
          actorUserId: user.userId,
          action: 'create',
          targetType: 'clock',
          targetId: 'clk-x',
        },
        { id: 'al-dup', at: '2026-05-16T00:00:00Z' },
      ),
    ).resolves.toBeUndefined();
  });

  test('omits before_json when entry.before is undefined', async () => {
    const { handle, user } = createTestDbWithUser();
    await writeAuditLog(
      handle.db,
      {
        stationId: user.stationId,
        actorUserId: user.userId,
        action: 'update',
        targetType: 'clock',
        targetId: 'clk-2',
        after: { name: 'New' },
      },
      { id: 'al-noprev', at: '2026-05-16T00:00:00Z' },
    );
    const rows = handle.mem.public.many(
      "SELECT before_json, after_json FROM audit_log WHERE id = 'al-noprev'",
    ) as Array<{ before_json: string | null; after_json: string }>;
    expect(rows[0].before_json).toBeNull();
    expect(JSON.parse(rows[0].after_json)).toEqual({ name: 'New' });
  });
});
