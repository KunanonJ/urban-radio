import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet, onRequestPatch, onRequestDelete } from './[id]';
import { onRequestPost as onSlotsPost, onRequestPut as onSlotsPut } from './[id]/slots';
import {
  onRequestPatch as onSlotPatch,
  onRequestDelete as onSlotDelete,
} from './[id]/slots/[slotId]';
import { getSessionFromRequest } from '../../_lib/session-jwt';
import type { SonicBloomEnv } from '../../_lib/env';

type AllResult = { results: unknown[]; success?: boolean };

const buildD1 = (
  allResults: AllResult[],
  firstResults: (unknown | null)[] = [],
) => {
  const preparedStatements: { sql: string; binds: unknown[] }[] = [];
  let allCallIdx = 0;
  let firstCallIdx = 0;
  const batchCalls: { sql: string; binds: unknown[] }[][] = [];
  const prepare = vi.fn((sql: string) => {
    const stmt = { sql, binds: [] as unknown[] };
    preparedStatements.push(stmt);
    const chain = {
      bind: (...args: unknown[]) => {
        stmt.binds.push(...args);
        return chain;
      },
      all: vi.fn().mockImplementation(() => {
        const res = allResults[allCallIdx] ?? { results: [], success: true };
        allCallIdx += 1;
        return Promise.resolve(res);
      }),
      first: vi.fn().mockImplementation(() => {
        const res = firstResults[firstCallIdx] ?? null;
        firstCallIdx += 1;
        return Promise.resolve(res);
      }),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    return chain;
  });
  const batch = vi.fn().mockImplementation((stmts: unknown[]) => {
    batchCalls.push([...preparedStatements]);
    return Promise.resolve(stmts.map(() => ({ success: true })));
  });
  return { prepare, batch, preparedStatements, batchCalls };
};

const buildEnv = (
  allResults: AllResult[],
  firstResults: (unknown | null)[] = [],
) => {
  const mockDb = buildD1(allResults, firstResults);
  return {
    env: { DB: mockDb, AUTH_JWT_SECRET: 'test-secret' } as unknown as SonicBloomEnv,
    mockDb,
  };
};

const buildRequest = (path = '/api/clocks/c1', init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cookie')) headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { ...init, headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

// A row shape that mirrors the clock-detail join in clock-queries.ts
const detailRowNoSlots = {
  clock_id: 'c1',
  clock_station_id: 'urban-radio',
  clock_name: 'Morning Mix',
  clock_color: '#3b82f6',
  clock_target_duration_ms: 3600000,
  clock_created_at: '2026-05-01T00:00:00Z',
  slot_id: null,
  slot_position: null,
  slot_type: null,
  slot_category_id: null,
  slot_duration_estimate_ms: null,
  slot_rules_json: null,
};

const detailRowWithSlot = {
  ...detailRowNoSlots,
  slot_id: 's1',
  slot_position: 0,
  slot_type: 'music',
  slot_category_id: 'cat-music',
  slot_duration_estimate_ms: 180000,
  slot_rules_json: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/clocks/:id', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/clocks/c1'),
      params: { id: 'c1' },
    });
    expect(res.status).toBe(401);
  });

  test('given cross-station id > returns 404 (no info leak)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true }, // detail returns no rows
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/clocks/other-station-clock'),
      params: { id: 'other-station-clock' },
    });
    expect(res.status).toBe(404);
  });

  test('given station-owned clock with slot > returns clock with slots array', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [detailRowWithSlot], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/clocks/c1'),
      params: { id: 'c1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clock: {
        id: string;
        name: string;
        slots: { id: string; slot_type: string; position: number }[];
      };
    };
    expect(body.clock.id).toBe('c1');
    expect(body.clock.name).toBe('Morning Mix');
    expect(body.clock.slots).toHaveLength(1);
    expect(body.clock.slots[0].id).toBe('s1');
    expect(body.clock.slots[0].slot_type).toBe('music');
  });

  test('given clock with no slots > returns empty slots array', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [detailRowNoSlots], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/clocks/c1'),
      params: { id: 'c1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clock: { slots: unknown[] } };
    expect(body.clock.slots).toHaveLength(0);
  });
});

describe('PATCH /api/clocks/:id', () => {
  test('given partial patch > applies and logs before/after', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [detailRowNoSlots], success: true }, // existence check
      { results: [{ ...detailRowNoSlots, clock_name: 'Renamed' }], success: true }, // after fetch
    ]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/clocks/c1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c1' },
    });
    expect(res.status).toBe(200);
    const update = mockDb.preparedStatements.find((s) => /UPDATE clocks/i.test(s.sql));
    expect(update).toBeDefined();
    expect(update!.binds).toContain('Renamed');
    const audit = mockDb.preparedStatements.find((s) => /INSERT INTO audit_log/i.test(s.sql));
    expect(audit).toBeDefined();
    expect(audit!.binds).toContain('update');
    expect(audit!.binds).toContain('clock');
  });

  test('given cross-station id > returns 404', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true }, // existence check fails
    ]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/clocks/other', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'X' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'other' },
    });
    expect(res.status).toBe(404);
  });

  test('given empty patch > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/clocks/c1', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c1' },
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/clocks/:id', () => {
  test('given cross-station id > returns 404', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/clocks/other', { method: 'DELETE' }),
      params: { id: 'other' },
    });
    expect(res.status).toBe(404);
  });

  test('given station-owned id > deletes clock and writes audit_log', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [detailRowNoSlots], success: true },
    ]);
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/clocks/c1', { method: 'DELETE' }),
      params: { id: 'c1' },
    });
    expect(res.status).toBe(204);
    const del = mockDb.preparedStatements.find((s) => /DELETE FROM clocks/i.test(s.sql));
    expect(del).toBeDefined();
    expect(del!.binds).toContain('c1');
    expect(del!.binds).toContain('urban-radio');
    const audit = mockDb.preparedStatements.find((s) => /INSERT INTO audit_log/i.test(s.sql));
    expect(audit).toBeDefined();
    expect(audit!.binds).toContain('delete');
  });
});

describe('POST /api/clocks/:id/slots', () => {
  test('given cross-station clock > returns 404 before insert', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onSlotsPost({
      env,
      request: buildRequest('/api/clocks/other/slots', {
        method: 'POST',
        body: JSON.stringify({ position: 0, slotType: 'music', durationEstimateMs: 1000 }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'other' },
    });
    expect(res.status).toBe(404);
  });

  test('given valid slot > creates and writes audit_log', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [detailRowNoSlots], success: true },
    ]);
    const res = await onSlotsPost({
      env,
      request: buildRequest('/api/clocks/c1/slots', {
        method: 'POST',
        body: JSON.stringify({
          position: 0,
          slotType: 'music',
          categoryId: 'cat-music',
          durationEstimateMs: 180000,
        }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c1' },
    });
    expect(res.status).toBe(201);
    const insertSlot = mockDb.preparedStatements.find(
      (s) => /INSERT INTO clock_slots/i.test(s.sql),
    );
    expect(insertSlot).toBeDefined();
    expect(insertSlot!.binds).toContain('music');
    expect(insertSlot!.binds).toContain(0);
    const audit = mockDb.preparedStatements.find((s) => /INSERT INTO audit_log/i.test(s.sql));
    expect(audit).toBeDefined();
    expect(audit!.binds).toContain('clock_slot');
  });

  test('given duplicate position > returns 409', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // Mock the DB: existence check passes, then the slot insert throws a UNIQUE constraint error
    const preparedStatements: { sql: string; binds: unknown[] }[] = [];
    const prepare = vi.fn((sql: string) => {
      const stmt = { sql, binds: [] as unknown[] };
      preparedStatements.push(stmt);
      return {
        bind: (...args: unknown[]) => {
          stmt.binds.push(...args);
          return {
            all: vi.fn().mockImplementation(() => {
              if (/station_members/.test(sql)) {
                return Promise.resolve({ results: [memberRow], success: true });
              }
              if (/FROM clocks/.test(sql)) {
                return Promise.resolve({ results: [detailRowNoSlots], success: true });
              }
              return Promise.resolve({ results: [], success: true });
            }),
            first: vi.fn().mockResolvedValue(null),
            run: vi.fn().mockImplementation(() => {
              if (/INSERT INTO clock_slots/.test(sql)) {
                throw new Error('UNIQUE constraint failed: clock_slots.clock_id, clock_slots.position');
              }
              return Promise.resolve({ success: true });
            }),
          };
        },
      };
    });
    const env = {
      DB: { prepare } as unknown as D1Database,
      AUTH_JWT_SECRET: 'test-secret',
    } as unknown as SonicBloomEnv;
    const res = await onSlotsPost({
      env,
      request: buildRequest('/api/clocks/c1/slots', {
        method: 'POST',
        body: JSON.stringify({ position: 0, slotType: 'music', durationEstimateMs: 1000 }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c1' },
    });
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/clocks/:id/slots (reorder)', () => {
  test('batch reorder of 5 > 200 with all positions updated', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [detailRowNoSlots], success: true },
    ]);
    const res = await onSlotsPut({
      env,
      request: buildRequest('/api/clocks/c1/slots', {
        method: 'PUT',
        body: JSON.stringify({
          order: [
            { id: 'a', position: 0 },
            { id: 'b', position: 1 },
            { id: 'c', position: 2 },
            { id: 'd', position: 3 },
            { id: 'e', position: 4 },
          ],
        }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c1' },
    });
    expect(res.status).toBe(200);
    // The reorder uses a batch with a "park" pass + "land" pass to dodge the UNIQUE
    // (clock_id, position) constraint. So we expect at least 10 UPDATE clock_slots
    // statements prepared.
    const updates = mockDb.preparedStatements.filter((s) =>
      /UPDATE clock_slots SET position/.test(s.sql),
    );
    expect(updates.length).toBeGreaterThanOrEqual(10);
    const audit = mockDb.preparedStatements.find((s) => /INSERT INTO audit_log/i.test(s.sql));
    expect(audit).toBeDefined();
    expect(audit!.binds).toContain('reorder');
  });

  test('reorder against cross-station clock > 404', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onSlotsPut({
      env,
      request: buildRequest('/api/clocks/other/slots', {
        method: 'PUT',
        body: JSON.stringify({ order: [{ id: 'a', position: 0 }] }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'other' },
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/clocks/:id/slots/:slotId', () => {
  test('given cross-station clock > returns 404', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onSlotPatch({
      env,
      request: buildRequest('/api/clocks/other/slots/s1', {
        method: 'PATCH',
        body: JSON.stringify({ position: 2 }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'other', slotId: 's1' },
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/clocks/:id/slots/:slotId', () => {
  test('deletes single slot and writes audit_log', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [detailRowWithSlot], success: true },
    ]);
    const res = await onSlotDelete({
      env,
      request: buildRequest('/api/clocks/c1/slots/s1', { method: 'DELETE' }),
      params: { id: 'c1', slotId: 's1' },
    });
    expect(res.status).toBe(204);
    const del = mockDb.preparedStatements.find((s) =>
      /DELETE FROM clock_slots/i.test(s.sql),
    );
    expect(del).toBeDefined();
    expect(del!.binds).toContain('s1');
    const audit = mockDb.preparedStatements.find((s) => /INSERT INTO audit_log/i.test(s.sql));
    expect(audit).toBeDefined();
    expect(audit!.binds).toContain('clock_slot');
    expect(audit!.binds).toContain('delete');
  });
});
