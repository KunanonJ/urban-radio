// @vitest-environment node
// Route handlers use `jose` (HS256); see require-station.test.ts for context.

/**
 * Wave RM-β4 — Clocks + schedule Next.js Route Handlers.
 *
 * Each test exercises the named inner helper with a pg-mem-backed Drizzle
 * client and an authed Request, then asserts on the response shape the
 * Cloudflare counterpart emits. The goal isn't to re-test the underlying
 * Drizzle/pg-mem layer — that's covered by `src/db/schema.test.ts`. We only
 * verify the route's input → output contract so the Railway and Cloudflare
 * stacks stay observationally identical.
 */

import { describe, expect, test } from 'vitest';

import {
  getClocks,
  postClocks,
} from '@/app/api/clocks/route-impl';
import {
  deleteClockHandler,
  getClock,
  patchClock,
} from '@/app/api/clocks/[id]/route-impl';
import {
  postSlot,
  putSlots,
} from '@/app/api/clocks/[id]/slots/route-impl';
import {
  deleteSlotHandler,
  patchSlot,
} from '@/app/api/clocks/[id]/slots/[slotId]/route-impl';
import {
  getSchedule,
  postSchedule,
} from '@/app/api/schedule/route-impl';
import {
  deleteScheduleById,
  getScheduleByIdRoute,
  patchScheduleById,
} from '@/app/api/schedule/[id]/route-impl';
import {
  signSessionToken,
  sessionCookieName,
} from '@/server/auth/session-jwt';
import {
  createTestDbWithUser,
  type TestDbHandle,
} from '@/server/test-utils/db';

const SECRET = 'beta4-test-secret';

async function authedRequest(
  userId: string,
  username: string,
  init: RequestInit & { url?: string } = {},
): Promise<Request> {
  const token = await signSessionToken(SECRET, { sub: userId, username });
  const headers = new Headers(init.headers);
  headers.set('Cookie', `${sessionCookieName()}=${encodeURIComponent(token)}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return new Request(init.url ?? 'http://localhost/api/anything', {
    method: init.method,
    body: init.body,
    headers,
  });
}

interface AuditRow {
  id: string;
  station_id: string;
  actor_user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  before_json: string | null;
  after_json: string | null;
}

function readAuditLog(handle: TestDbHandle, targetId: string): AuditRow[] {
  return handle.mem.public.many(
    `SELECT * FROM audit_log WHERE target_id = '${targetId}' ORDER BY at ASC, id ASC`,
  ) as AuditRow[];
}

function seedClock(
  handle: TestDbHandle,
  args: {
    id: string;
    stationId: string;
    name?: string;
    color?: string;
    targetDurationMs?: number;
    createdAt?: string;
  },
): void {
  const name = args.name ?? 'Test Clock';
  const color = args.color ?? '#3b82f6';
  const target = args.targetDurationMs ?? 3_600_000;
  const createdAt = args.createdAt ?? '2026-01-02T00:00:00Z';
  handle.mem.public.none(
    `INSERT INTO clocks (id, station_id, name, color, target_duration_ms, created_at)
     VALUES ('${args.id}', '${args.stationId}', '${name}', '${color}', ${target}, '${createdAt}')`,
  );
}

function seedSlot(
  handle: TestDbHandle,
  args: {
    id: string;
    clockId: string;
    position: number;
    slotType?: string;
    durationEstimateMs?: number;
  },
): void {
  const slotType = args.slotType ?? 'music';
  const dur = args.durationEstimateMs ?? 200_000;
  handle.mem.public.none(
    `INSERT INTO clock_slots (id, clock_id, position, slot_type, duration_estimate_ms)
     VALUES ('${args.id}', '${args.clockId}', ${args.position}, '${slotType}', ${dur})`,
  );
}

function seedAssignment(
  handle: TestDbHandle,
  args: {
    id: string;
    stationId: string;
    clockId: string;
    weekday: number;
    hour: number;
    createdAt?: string;
  },
): void {
  const createdAt = args.createdAt ?? '2026-01-02T00:00:00Z';
  handle.mem.public.none(
    `INSERT INTO schedule_assignments (id, station_id, clock_id, weekday, hour, created_at)
     VALUES ('${args.id}', '${args.stationId}', '${args.clockId}', ${args.weekday}, ${args.hour}, '${createdAt}')`,
  );
}

// ===========================================================================
// /api/clocks
// ===========================================================================

describe('GET /api/clocks', () => {
  test('200 with clocks list ordered by created_at ASC, id ASC', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, {
      id: 'clk-b',
      stationId: user.stationId,
      name: 'Drive',
      createdAt: '2026-02-01T00:00:00Z',
    });
    seedClock(handle, {
      id: 'clk-a',
      stationId: user.stationId,
      name: 'Morning',
      createdAt: '2026-01-15T00:00:00Z',
    });

    const req = await authedRequest(user.userId, user.username);
    const res = await getClocks(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clocks: Array<{ id: string; name: string; color: string; targetDurationMs: number }>;
      meta: { limit: number };
    };
    expect(body.clocks).toHaveLength(2);
    expect(body.clocks[0].id).toBe('clk-a');
    expect(body.clocks[1].id).toBe('clk-b');
    expect(body.clocks[0].color).toBe('#3b82f6');
    expect(body.clocks[0].targetDurationMs).toBe(3_600_000);
    expect(body.meta.limit).toBe(2);
  });

  test('401 when no session cookie', async () => {
    const { handle } = createTestDbWithUser();
    const req = new Request('http://localhost/api/clocks');
    const res = await getClocks(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(401);
  });

  test('returns empty list when station has no clocks', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username);
    const res = await getClocks(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clocks: unknown[]; meta: { limit: number } };
    expect(body.clocks).toEqual([]);
    expect(body.meta.limit).toBe(0);
  });
});

describe('POST /api/clocks', () => {
  test('201 + audit row on valid create', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      body: JSON.stringify({ name: 'New Clock', color: '#ff8800' }),
    });
    const res = await postClocks(req, {
      db: handle.db,
      secret: SECRET,
      newId: () => 'clk-new',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      clock: { id: string; name: string; color: string; targetDurationMs: number };
    };
    expect(body.clock.id).toBe('clk-new');
    expect(body.clock.name).toBe('New Clock');
    expect(body.clock.color).toBe('#ff8800');
    expect(body.clock.targetDurationMs).toBe(3_600_000);

    // Persisted in DB.
    const rows = handle.mem.public.many(
      "SELECT * FROM clocks WHERE id = 'clk-new'",
    ) as Array<{ name: string; color: string; target_duration_ms: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('New Clock');

    // Audit log written.
    const audit = readAuditLog(handle, 'clk-new');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('create');
    expect(audit[0].target_type).toBe('clock');
    expect(audit[0].actor_user_id).toBe(user.userId);
    expect(JSON.parse(audit[0].after_json!)).toMatchObject({
      id: 'clk-new',
      name: 'New Clock',
      color: '#ff8800',
    });
  });

  test('400 on invalid JSON body', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      body: 'not-json{',
    });
    const res = await postClocks(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(400);
  });

  test('400 when zod validation fails (missing name)', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      body: JSON.stringify({ color: '#abcdef' }),
    });
    const res = await postClocks(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Validation failed');
  });

  test('401 when no session', async () => {
    const { handle } = createTestDbWithUser();
    const req = new Request('http://localhost/api/clocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    const res = await postClocks(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// /api/clocks/[id]
// ===========================================================================

describe('GET /api/clocks/[id]', () => {
  test('200 with clock detail + slots ordered by position', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId, name: 'C1' });
    seedSlot(handle, { id: 'slot-2', clockId: 'clk-1', position: 1 });
    seedSlot(handle, { id: 'slot-1', clockId: 'clk-1', position: 0 });

    const req = await authedRequest(user.userId, user.username);
    const res = await getClock(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clock: {
        id: string;
        name: string;
        slots: Array<{ id: string; position: number; slot_type: string }>;
      };
    };
    expect(body.clock.id).toBe('clk-1');
    expect(body.clock.slots).toHaveLength(2);
    expect(body.clock.slots[0].id).toBe('slot-1');
    expect(body.clock.slots[0].position).toBe(0);
    expect(body.clock.slots[0].slot_type).toBe('music');
    expect(body.clock.slots[1].id).toBe('slot-2');
  });

  test('404 when clock does not exist', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username);
    const res = await getClock(req, 'missing', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });

  test('404 when clock belongs to a different station', async () => {
    const { handle, user } = createTestDbWithUser();
    // Seed another station + clock.
    handle.mem.public.none(
      `INSERT INTO stations (id, org_id, slug, name, timezone, created_at) VALUES ('other-station', '${user.orgId}', 'o', 'O', 'UTC', '2026-01-01T00:00:00Z')`,
    );
    seedClock(handle, { id: 'clk-foreign', stationId: 'other-station' });

    const req = await authedRequest(user.userId, user.username);
    const res = await getClock(req, 'clk-foreign', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/clocks/[id]', () => {
  test('200 + audit row on valid update', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, {
      id: 'clk-1',
      stationId: user.stationId,
      name: 'Old',
      color: '#000000',
    });

    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New Name', color: '#ffffff' }),
    });
    const res = await patchClock(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clock: { name: string; color: string } };
    expect(body.clock.name).toBe('New Name');
    expect(body.clock.color).toBe('#ffffff');

    const audit = readAuditLog(handle, 'clk-1');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('update');
    expect(JSON.parse(audit[0].before_json!)).toMatchObject({
      name: 'Old',
      color: '#000000',
    });
    expect(JSON.parse(audit[0].after_json!)).toMatchObject({
      name: 'New Name',
      color: '#ffffff',
    });
  });

  test('400 on empty patch', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    const res = await patchClock(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Empty patch');
  });

  test('404 when clock missing', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New' }),
    });
    const res = await patchClock(req, 'missing', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/clocks/[id]', () => {
  test('204 + audit row on valid delete', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, {
      id: 'clk-1',
      stationId: user.stationId,
      name: 'Doomed',
    });

    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteClockHandler(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(204);

    // Confirm row gone.
    const rows = handle.mem.public.many(
      "SELECT id FROM clocks WHERE id = 'clk-1'",
    );
    expect(rows).toHaveLength(0);

    const audit = readAuditLog(handle, 'clk-1');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('delete');
    expect(JSON.parse(audit[0].before_json!)).toMatchObject({
      name: 'Doomed',
    });
  });

  test('404 when clock missing', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteClockHandler(req, 'missing', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// /api/clocks/[id]/slots
// ===========================================================================

describe('POST /api/clocks/[id]/slots', () => {
  test('201 + audit row on valid slot create', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });

    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      body: JSON.stringify({
        position: 0,
        slotType: 'music',
        durationEstimateMs: 200_000,
      }),
    });
    const res = await postSlot(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
      newId: () => 'slot-new',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      slot: { id: string; position: number; slotType: string };
    };
    expect(body.slot.id).toBe('slot-new');
    expect(body.slot.position).toBe(0);
    expect(body.slot.slotType).toBe('music');

    const audit = readAuditLog(handle, 'slot-new');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('create');
    expect(audit[0].target_type).toBe('clock_slot');
  });

  test('409 when position is already used (UNIQUE collision)', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedSlot(handle, { id: 'slot-existing', clockId: 'clk-1', position: 0 });

    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      body: JSON.stringify({
        position: 0,
        slotType: 'music',
        durationEstimateMs: 1000,
      }),
    });
    const res = await postSlot(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
      newId: () => 'slot-dup',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Slot position already in use');
  });

  test('404 when parent clock does not exist', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      body: JSON.stringify({
        position: 0,
        slotType: 'music',
        durationEstimateMs: 1000,
      }),
    });
    const res = await postSlot(req, 'missing', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });

  test('400 when slotType is not in the allowed enum', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });

    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      body: JSON.stringify({
        position: 0,
        slotType: 'invalid-type',
        durationEstimateMs: 1000,
      }),
    });
    const res = await postSlot(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/clocks/[id]/slots (reorder)', () => {
  test('200 + audit reorder on valid swap', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedSlot(handle, { id: 'slot-a', clockId: 'clk-1', position: 0 });
    seedSlot(handle, { id: 'slot-b', clockId: 'clk-1', position: 1 });

    const req = await authedRequest(user.userId, user.username, {
      method: 'PUT',
      body: JSON.stringify({
        order: [
          { id: 'slot-a', position: 1 },
          { id: 'slot-b', position: 0 },
        ],
      }),
    });
    const res = await putSlots(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      order: Array<{ id: string; position: number }>;
    };
    expect(body.ok).toBe(true);

    // Final positions written.
    const rows = handle.mem.public.many(
      "SELECT id, position FROM clock_slots WHERE clock_id = 'clk-1' ORDER BY position",
    ) as Array<{ id: string; position: number }>;
    expect(rows).toEqual([
      { id: 'slot-b', position: 0 },
      { id: 'slot-a', position: 1 },
    ]);

    const audit = readAuditLog(handle, 'clk-1');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('reorder');
    expect(audit[0].target_type).toBe('clock_slot');
  });

  test('400 on empty order array', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PUT',
      body: JSON.stringify({ order: [] }),
    });
    const res = await putSlots(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('404 when parent clock missing', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username, {
      method: 'PUT',
      body: JSON.stringify({
        order: [{ id: 'slot-a', position: 0 }],
      }),
    });
    const res = await putSlots(req, 'missing', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// /api/clocks/[id]/slots/[slotId]
// ===========================================================================

describe('PATCH /api/clocks/[id]/slots/[slotId]', () => {
  test('200 + audit on valid slot update', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedSlot(handle, {
      id: 'slot-1',
      clockId: 'clk-1',
      position: 0,
      durationEstimateMs: 200_000,
    });

    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ durationEstimateMs: 300_000 }),
    });
    const res = await patchSlot(req, 'clk-1', 'slot-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const rows = handle.mem.public.many(
      "SELECT duration_estimate_ms FROM clock_slots WHERE id = 'slot-1'",
    ) as Array<{ duration_estimate_ms: number }>;
    expect(rows[0].duration_estimate_ms).toBe(300_000);

    const audit = readAuditLog(handle, 'slot-1');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('update');
  });

  test('400 on empty patch', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedSlot(handle, { id: 'slot-1', clockId: 'clk-1', position: 0 });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    const res = await patchSlot(req, 'clk-1', 'slot-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('404 when slot does not belong to clock', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ durationEstimateMs: 1000 }),
    });
    const res = await patchSlot(req, 'clk-1', 'missing', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/clocks/[id]/slots/[slotId]', () => {
  test('204 + audit on valid delete', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedSlot(handle, { id: 'slot-1', clockId: 'clk-1', position: 0 });

    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteSlotHandler(req, 'clk-1', 'slot-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(204);

    const rows = handle.mem.public.many(
      "SELECT id FROM clock_slots WHERE id = 'slot-1'",
    );
    expect(rows).toHaveLength(0);

    const audit = readAuditLog(handle, 'slot-1');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('delete');
    expect(audit[0].target_type).toBe('clock_slot');
  });

  test('404 when slot missing', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteSlotHandler(req, 'clk-1', 'missing', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// /api/schedule
// ===========================================================================

describe('GET /api/schedule', () => {
  test('200 lists station assignments sorted by (weekday, hour)', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-2',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 3,
      hour: 14,
    });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 1,
      hour: 9,
    });

    const req = await authedRequest(user.userId, user.username);
    const res = await getSchedule(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assignments: Array<{ id: string; weekday: number; hour: number }>;
      source: string;
    };
    expect(body.assignments).toHaveLength(2);
    expect(body.assignments[0].id).toBe('a-1');
    expect(body.assignments[1].id).toBe('a-2');
    expect(body.source).toBe('d1');
  });

  test('400 on invalid weekday filter', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username, {
      url: 'http://localhost/api/schedule?weekday=9',
    });
    const res = await getSchedule(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(400);
  });

  test('401 when no session', async () => {
    const { handle } = createTestDbWithUser();
    const req = new Request('http://localhost/api/schedule');
    const res = await getSchedule(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/schedule', () => {
  test('201 + audit row on valid create with no conflict', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      url: 'http://localhost/api/schedule',
      body: JSON.stringify({
        clockId: 'clk-1',
        weekday: 2,
        hour: 10,
      }),
    });
    const res = await postSchedule(req, {
      db: handle.db,
      secret: SECRET,
      newId: () => 'a-new',
      now: () => new Date('2026-05-16T00:00:00Z'),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      assignment: { id: string; weekday: number; hour: number; clockId: string };
      overrode: unknown[];
    };
    expect(body.assignment.id).toBe('a-new');
    expect(body.assignment.weekday).toBe(2);
    expect(body.assignment.hour).toBe(10);
    expect(body.overrode).toEqual([]);

    const audit = readAuditLog(handle, 'a-new');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('create');
    expect(audit[0].target_type).toBe('schedule_assignment');
  });

  test('409 with conflicts when cell occupied and no ?force=1', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-existing',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 2,
      hour: 10,
    });
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      url: 'http://localhost/api/schedule',
      body: JSON.stringify({
        clockId: 'clk-1',
        weekday: 2,
        hour: 10,
      }),
    });
    const res = await postSchedule(req, {
      db: handle.db,
      secret: SECRET,
      newId: () => 'a-new',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      conflicts: Array<{ id: string }>;
    };
    expect(body.error).toBe('overlap');
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].id).toBe('a-existing');
  });

  test('201 + override when ?force=1 (conflict deleted + audited)', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-existing',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 4,
      hour: 12,
    });
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      url: 'http://localhost/api/schedule?force=1',
      body: JSON.stringify({
        clockId: 'clk-1',
        weekday: 4,
        hour: 12,
      }),
    });
    const res = await postSchedule(req, {
      db: handle.db,
      secret: SECRET,
      newId: () => 'a-new',
      now: () => new Date('2026-05-16T00:00:00Z'),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      assignment: { id: string };
      overrode: Array<{ id: string }>;
    };
    expect(body.assignment.id).toBe('a-new');
    expect(body.overrode).toHaveLength(1);
    expect(body.overrode[0].id).toBe('a-existing');

    // Old assignment gone, new one present.
    const remaining = handle.mem.public.many(
      `SELECT id FROM schedule_assignments WHERE station_id = '${user.stationId}'`,
    ) as Array<{ id: string }>;
    expect(remaining.map((r) => r.id).sort()).toEqual(['a-new']);

    // Both delete + create audit entries written.
    const deleteAudit = readAuditLog(handle, 'a-existing');
    expect(deleteAudit).toHaveLength(1);
    expect(deleteAudit[0].action).toBe('delete');
    const createAudit = readAuditLog(handle, 'a-new');
    expect(createAudit).toHaveLength(1);
    expect(createAudit[0].action).toBe('create');
  });

  test('400 on invalid rrule', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      url: 'http://localhost/api/schedule',
      body: JSON.stringify({
        clockId: 'clk-1',
        weekday: 2,
        hour: 10,
        rrule: 'FREQ=NONSENSE',
      }),
    });
    const res = await postSchedule(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Invalid rrule/);
  });

  test('400 when weekday out of range', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      url: 'http://localhost/api/schedule',
      body: JSON.stringify({
        clockId: 'clk-1',
        weekday: 9,
        hour: 10,
      }),
    });
    const res = await postSchedule(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// /api/schedule/[id]
// ===========================================================================

describe('GET /api/schedule/[id]', () => {
  test('200 on existing assignment', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 0,
      hour: 0,
    });
    const req = await authedRequest(user.userId, user.username);
    const res = await getScheduleByIdRoute(req, 'a-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assignment: { id: string };
      source: string;
    };
    expect(body.assignment.id).toBe('a-1');
    expect(body.source).toBe('d1');
  });

  test('404 when not found', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username);
    const res = await getScheduleByIdRoute(req, 'missing', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/schedule/[id]', () => {
  test('200 + audit on simple field update without cell move', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 2,
      hour: 10,
    });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ validFrom: '2026-06-01T00:00:00Z' }),
    });
    const res = await patchScheduleById(req, 'a-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assignment: { validFrom: string };
      overrode: unknown[];
    };
    expect(body.assignment.validFrom).toBe('2026-06-01T00:00:00Z');
    expect(body.overrode).toEqual([]);

    const audit = readAuditLog(handle, 'a-1');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('update');
  });

  test('409 when moving to occupied cell without ?force=1', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 2,
      hour: 10,
    });
    seedAssignment(handle, {
      id: 'a-2',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 3,
      hour: 11,
    });

    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      url: 'http://localhost/api/schedule/a-1',
      body: JSON.stringify({ weekday: 3, hour: 11 }),
    });
    const res = await patchScheduleById(req, 'a-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      conflicts: Array<{ id: string }>;
    };
    expect(body.error).toBe('overlap');
    expect(body.conflicts.map((c) => c.id)).toEqual(['a-2']);
  });

  test('400 on empty patch', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 0,
      hour: 0,
    });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    const res = await patchScheduleById(req, 'a-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('no fields to update');
  });

  test('404 when assignment missing', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ weekday: 0 }),
    });
    const res = await patchScheduleById(req, 'missing', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/schedule/[id]', () => {
  test('200 + audit row + deleted snapshot returned', async () => {
    const { handle, user } = createTestDbWithUser();
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 2,
      hour: 10,
    });
    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteScheduleById(req, 'a-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      deleted: { id: string };
    };
    expect(body.ok).toBe(true);
    expect(body.deleted.id).toBe('a-1');

    const remaining = handle.mem.public.many(
      "SELECT id FROM schedule_assignments WHERE id = 'a-1'",
    );
    expect(remaining).toHaveLength(0);

    const audit = readAuditLog(handle, 'a-1');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('delete');
  });

  test('404 when missing', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteScheduleById(req, 'missing', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// H-05 — Role gate on /api/clocks CRUD
// ===========================================================================

describe('H-05: role gate — POST /api/clocks', () => {
  test('403 when operator tries to create a clock', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'operator' });
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      body: JSON.stringify({ name: 'Blocked Clock' }),
    });
    const res = await postClocks(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(403);
  });

  test('201 when programmer creates a clock', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'programmer' });
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      body: JSON.stringify({ name: 'Programmer Clock' }),
    });
    const res = await postClocks(req, {
      db: handle.db,
      secret: SECRET,
      newId: () => 'clk-prog',
    });
    expect(res.status).toBe(201);
  });
});

describe('H-05: role gate — PATCH /api/clocks/[id]', () => {
  test('403 when operator tries to patch a clock', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'operator' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Hacked' }),
    });
    const res = await patchClock(req, 'clk-1', { db: handle.db, secret: SECRET });
    expect(res.status).toBe(403);
  });

  test('200 when admin patches a clock', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId, name: 'Old' });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New' }),
    });
    const res = await patchClock(req, 'clk-1', { db: handle.db, secret: SECRET });
    expect(res.status).toBe(200);
  });
});

describe('H-05: role gate — DELETE /api/clocks/[id]', () => {
  test('403 when producer tries to delete a clock', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'producer' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteClockHandler(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('204 when admin deletes a clock', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteClockHandler(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(204);
  });
});

describe('H-05: role gate — POST /api/clocks/[id]/slots', () => {
  test('403 when operator tries to create a slot', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'operator' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      body: JSON.stringify({ position: 0, slotType: 'music', durationEstimateMs: 200_000 }),
    });
    const res = await postSlot(req, 'clk-1', { db: handle.db, secret: SECRET });
    expect(res.status).toBe(403);
  });

  test('201 when programmer creates a slot', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'programmer' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      body: JSON.stringify({ position: 0, slotType: 'music', durationEstimateMs: 200_000 }),
    });
    const res = await postSlot(req, 'clk-1', {
      db: handle.db,
      secret: SECRET,
      newId: () => 'slot-prog',
    });
    expect(res.status).toBe(201);
  });
});

describe('H-05: role gate — PUT /api/clocks/[id]/slots', () => {
  test('403 when operator tries to reorder slots', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'operator' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedSlot(handle, { id: 'slot-a', clockId: 'clk-1', position: 0 });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PUT',
      body: JSON.stringify({ order: [{ id: 'slot-a', position: 0 }] }),
    });
    const res = await putSlots(req, 'clk-1', { db: handle.db, secret: SECRET });
    expect(res.status).toBe(403);
  });

  test('200 when admin reorders slots', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedSlot(handle, { id: 'slot-a', clockId: 'clk-1', position: 0 });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PUT',
      body: JSON.stringify({ order: [{ id: 'slot-a', position: 0 }] }),
    });
    const res = await putSlots(req, 'clk-1', { db: handle.db, secret: SECRET });
    expect(res.status).toBe(200);
  });
});

describe('H-05: role gate — PATCH /api/clocks/[id]/slots/[slotId]', () => {
  test('403 when guest_vt tries to patch a slot', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'guest_vt' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedSlot(handle, { id: 'slot-1', clockId: 'clk-1', position: 0 });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ durationEstimateMs: 1000 }),
    });
    const res = await patchSlot(req, 'clk-1', 'slot-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('200 when programmer patches a slot', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'programmer' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedSlot(handle, { id: 'slot-1', clockId: 'clk-1', position: 0, durationEstimateMs: 200_000 });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ durationEstimateMs: 300_000 }),
    });
    const res = await patchSlot(req, 'clk-1', 'slot-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
  });
});

describe('H-05: role gate — DELETE /api/clocks/[id]/slots/[slotId]', () => {
  test('403 when operator tries to delete a slot', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'operator' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedSlot(handle, { id: 'slot-1', clockId: 'clk-1', position: 0 });
    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteSlotHandler(req, 'clk-1', 'slot-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('204 when admin deletes a slot', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedSlot(handle, { id: 'slot-1', clockId: 'clk-1', position: 0 });
    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteSlotHandler(req, 'clk-1', 'slot-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(204);
  });
});

// ===========================================================================
// H-06 — Role gate on /api/schedule CRUD
// ===========================================================================

describe('H-06: role gate — POST /api/schedule', () => {
  test('403 when operator tries to create a schedule assignment', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'operator' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      url: 'http://localhost/api/schedule',
      body: JSON.stringify({ clockId: 'clk-1', weekday: 1, hour: 9 }),
    });
    const res = await postSchedule(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(403);
  });

  test('201 when programmer creates a schedule assignment', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'programmer' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      url: 'http://localhost/api/schedule',
      body: JSON.stringify({ clockId: 'clk-1', weekday: 1, hour: 9 }),
    });
    const res = await postSchedule(req, {
      db: handle.db,
      secret: SECRET,
      newId: () => 'a-prog',
      now: () => new Date('2026-05-16T00:00:00Z'),
    });
    expect(res.status).toBe(201);
  });
});

describe('H-06: role gate — PATCH /api/schedule/[id]', () => {
  test('403 when producer tries to patch a schedule assignment', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'producer' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 2,
      hour: 10,
    });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ validFrom: '2026-07-01T00:00:00Z' }),
    });
    const res = await patchScheduleById(req, 'a-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('200 when admin patches a schedule assignment', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 2,
      hour: 10,
    });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ validFrom: '2026-07-01T00:00:00Z' }),
    });
    const res = await patchScheduleById(req, 'a-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
  });
});

describe('H-06: role gate — DELETE /api/schedule/[id]', () => {
  test('403 when operator tries to delete a schedule assignment', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'operator' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 0,
      hour: 0,
    });
    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteScheduleById(req, 'a-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('200 when programmer deletes a schedule assignment', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'programmer' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 0,
      hour: 0,
    });
    const req = await authedRequest(user.userId, user.username, {
      method: 'DELETE',
    });
    const res = await deleteScheduleById(req, 'a-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// H-07 — Cross-tenant clockId injection in POST/PATCH /api/schedule
// ===========================================================================

describe('H-07: clockId ownership — POST /api/schedule', () => {
  test('400 when clockId belongs to a different station', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    // Seed a second station with its own clock.
    handle.mem.public.none(
      `INSERT INTO stations (id, org_id, slug, name, timezone, created_at) VALUES ('other-station', '${user.orgId}', 'other', 'Other', 'UTC', '2026-01-01T00:00:00Z')`,
    );
    handle.mem.public.none(
      `INSERT INTO clocks (id, station_id, name, color, target_duration_ms, created_at) VALUES ('clk-foreign', 'other-station', 'Foreign', '#000000', 3600000, '2026-01-01T00:00:00Z')`,
    );
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      url: 'http://localhost/api/schedule',
      body: JSON.stringify({ clockId: 'clk-foreign', weekday: 1, hour: 9 }),
    });
    const res = await postSchedule(req, {
      db: handle.db,
      secret: SECRET,
      newId: () => 'a-bad',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Clock not found in this station');
  });

  test('201 when clockId belongs to the same station', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    seedClock(handle, { id: 'clk-owned', stationId: user.stationId });
    const req = await authedRequest(user.userId, user.username, {
      method: 'POST',
      url: 'http://localhost/api/schedule',
      body: JSON.stringify({ clockId: 'clk-owned', weekday: 1, hour: 9 }),
    });
    const res = await postSchedule(req, {
      db: handle.db,
      secret: SECRET,
      newId: () => 'a-good',
      now: () => new Date('2026-05-16T00:00:00Z'),
    });
    expect(res.status).toBe(201);
  });
});

describe('H-07: clockId ownership — PATCH /api/schedule/[id]', () => {
  test('400 when patching clockId to a foreign station clock', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    seedClock(handle, { id: 'clk-owned', stationId: user.stationId });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-owned',
      weekday: 2,
      hour: 10,
    });
    // Seed a foreign clock on a different station.
    handle.mem.public.none(
      `INSERT INTO stations (id, org_id, slug, name, timezone, created_at) VALUES ('other-station', '${user.orgId}', 'other', 'Other', 'UTC', '2026-01-01T00:00:00Z')`,
    );
    handle.mem.public.none(
      `INSERT INTO clocks (id, station_id, name, color, target_duration_ms, created_at) VALUES ('clk-foreign', 'other-station', 'Foreign', '#000000', 3600000, '2026-01-01T00:00:00Z')`,
    );
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ clockId: 'clk-foreign' }),
    });
    const res = await patchScheduleById(req, 'a-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Clock not found in this station');
  });

  test('200 when patching clockId to a same-station clock', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    seedClock(handle, { id: 'clk-1', stationId: user.stationId });
    seedClock(handle, {
      id: 'clk-2',
      stationId: user.stationId,
      name: 'Second',
      createdAt: '2026-02-01T00:00:00Z',
    });
    seedAssignment(handle, {
      id: 'a-1',
      stationId: user.stationId,
      clockId: 'clk-1',
      weekday: 2,
      hour: 10,
    });
    const req = await authedRequest(user.userId, user.username, {
      method: 'PATCH',
      body: JSON.stringify({ clockId: 'clk-2' }),
    });
    const res = await patchScheduleById(req, 'a-1', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assignment: { clockId: string } };
    expect(body.assignment.clockId).toBe('clk-2');
  });
});
