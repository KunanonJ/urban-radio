/**
 * Unit tests for the pure helpers in `migrate-d1-to-pg.mjs`. No D1, no PG —
 * we drive the orchestrator with injected fakes so the tests are fast and
 * deterministic.
 */

import { describe, expect, test, vi } from 'vitest';

import {
  TABLES_IN_FK_ORDER,
  buildUpsertSql,
  parseD1JsonResult,
  runSync,
} from './migrate-d1-to-pg.mjs';

describe('TABLES_IN_FK_ORDER', () => {
  test('covers all 21 production tables', () => {
    const names = TABLES_IN_FK_ORDER.map((t) => t.name);
    expect(names.length).toBe(21);
    // Spot-check a few key tables.
    expect(names).toContain('organizations');
    expect(names).toContain('stations');
    expect(names).toContain('station_members');
    expect(names).toContain('voice_tracks');
    expect(names).toContain('presence_sessions');
  });

  test('parents come before children for known FK pairs', () => {
    const indexOf = (n) => TABLES_IN_FK_ORDER.findIndex((t) => t.name === n);
    expect(indexOf('organizations')).toBeLessThan(indexOf('stations'));
    expect(indexOf('stations')).toBeLessThan(indexOf('station_members'));
    expect(indexOf('auth_users')).toBeLessThan(indexOf('station_members'));
    expect(indexOf('artists')).toBeLessThan(indexOf('albums'));
    expect(indexOf('albums')).toBeLessThan(indexOf('tracks'));
    expect(indexOf('tracks')).toBeLessThan(indexOf('playlist_tracks'));
    expect(indexOf('stations')).toBeLessThan(indexOf('radio_tracks'));
    expect(indexOf('stations')).toBeLessThan(indexOf('clocks'));
    expect(indexOf('clocks')).toBeLessThan(indexOf('clock_slots'));
    expect(indexOf('stations')).toBeLessThan(indexOf('schedule_assignments'));
    expect(indexOf('clocks')).toBeLessThan(indexOf('schedule_assignments'));
  });

  test('composite-PK tables have multiple PK columns', () => {
    const sm = TABLES_IN_FK_ORDER.find((t) => t.name === 'station_members');
    expect(sm?.pk).toEqual(['station_id', 'user_id']);
    const pt = TABLES_IN_FK_ORDER.find((t) => t.name === 'playlist_tracks');
    expect(pt?.pk).toEqual(['playlist_id', 'track_id']);
  });
});

describe('parseD1JsonResult', () => {
  test('extracts results array from wrangler envelope', () => {
    const raw = JSON.stringify([
      {
        results: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        success: true,
        meta: { duration: 5 },
      },
    ]);
    const rows = parseD1JsonResult(raw);
    expect(rows).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
  });

  test('returns [] for an empty envelope', () => {
    expect(parseD1JsonResult(JSON.stringify([]))).toEqual([]);
    expect(parseD1JsonResult(JSON.stringify([{ success: true }]))).toEqual([]);
  });

  test('throws on malformed JSON', () => {
    expect(() => parseD1JsonResult('not-json{')).toThrow();
  });
});

describe('buildUpsertSql', () => {
  test('single-PK table → DO UPDATE SET only non-PK columns', () => {
    const { sql, params } = buildUpsertSql(
      'organizations',
      { id: 'o-1', name: 'Acme', plan: 'pro' },
      ['id'],
    );
    expect(sql).toContain('INSERT INTO "organizations"');
    expect(sql).toContain('"id", "name", "plan"');
    expect(sql).toContain('VALUES ($1, $2, $3)');
    expect(sql).toContain('ON CONFLICT ("id") DO UPDATE SET');
    expect(sql).toContain('"name" = EXCLUDED."name"');
    expect(sql).toContain('"plan" = EXCLUDED."plan"');
    expect(sql).not.toContain('"id" = EXCLUDED."id"');
    expect(params).toEqual(['o-1', 'Acme', 'pro']);
  });

  test('composite-PK table → both PK cols in ON CONFLICT', () => {
    const { sql } = buildUpsertSql(
      'station_members',
      { station_id: 's-1', user_id: 'u-1', role: 'admin' },
      ['station_id', 'user_id'],
    );
    expect(sql).toContain('ON CONFLICT ("station_id", "user_id") DO UPDATE SET');
    expect(sql).toContain('"role" = EXCLUDED."role"');
    expect(sql).not.toContain('"station_id" = EXCLUDED."station_id"');
    expect(sql).not.toContain('"user_id" = EXCLUDED."user_id"');
  });

  test('DO NOTHING when every column is part of the PK', () => {
    const { sql } = buildUpsertSql(
      'playlist_tracks',
      { playlist_id: 'p-1', track_id: 't-1' },
      ['playlist_id', 'track_id'],
    );
    expect(sql).toContain('ON CONFLICT ("playlist_id", "track_id") DO NOTHING');
    expect(sql).not.toContain('DO UPDATE');
  });

  test('rejects rows missing a PK column', () => {
    expect(() =>
      buildUpsertSql('stations', { name: 'no-id' }, ['id']),
    ).toThrow(/missing PK column "id"/);
  });

  test('rejects identifiers that could be unsafe to quote', () => {
    expect(() =>
      buildUpsertSql('stations', { 'id"; DROP TABLE stations; --': 'x' }, [
        'id"; DROP TABLE stations; --',
      ]),
    ).toThrow(/unexpected identifier/);
  });
});

describe('runSync', () => {
  test('dry-run never calls pgQuery', async () => {
    const reads = {};
    const pgQuery = vi.fn(async () => {});
    const result = await runSync({
      apply: false,
      readTable: async (t) => {
        reads[t] = true;
        return [];
      },
      pgQuery,
      logger: silentLogger(),
    });
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(pgQuery).not.toHaveBeenCalled();
    expect(result.report.length).toBe(TABLES_IN_FK_ORDER.length);
    // Every table was read once.
    for (const t of TABLES_IN_FK_ORDER) {
      expect(reads[t.name]).toBe(true);
    }
  });

  test('apply mode calls pgQuery once per row', async () => {
    const pgQuery = vi.fn(async () => {});
    const pgCount = vi.fn(async () => 2);
    const result = await runSync({
      apply: true,
      tables: ['organizations'],
      readTable: async () => [
        { id: 'o-1', name: 'A', plan: 'free', created_at: 'X' },
        { id: 'o-2', name: 'B', plan: 'pro', created_at: 'X' },
      ],
      pgQuery,
      pgCount,
      logger: silentLogger(),
    });
    expect(result.ok).toBe(true);
    expect(pgQuery).toHaveBeenCalledTimes(2);
    expect(pgCount).toHaveBeenCalledOnce();
    expect(result.report[0]).toMatchObject({
      table: 'organizations',
      d1Count: 2,
      applied: 2,
      pgCount: 2,
      ok: true,
    });
  });

  test('captures the first row-level error per table and keeps going', async () => {
    let calls = 0;
    const pgQuery = vi.fn(async () => {
      calls += 1;
      if (calls === 2) throw new Error('boom on second row');
    });
    const result = await runSync({
      apply: true,
      tables: ['organizations'],
      readTable: async () => [
        { id: 'o-1', name: 'A', plan: 'free', created_at: 'X' },
        { id: 'o-2', name: 'B', plan: 'pro', created_at: 'X' },
        { id: 'o-3', name: 'C', plan: 'pro', created_at: 'X' },
      ],
      pgQuery,
      logger: silentLogger(),
    });
    // 3 attempts, 2 successes (first and third), 1 failure (second).
    expect(pgQuery).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    expect(result.report[0].applied).toBe(2);
    expect(result.report[0].error).toMatch(/boom/);
  });

  test('apply mode without pgQuery refuses to start', async () => {
    await expect(
      runSync({ apply: true, readTable: async () => [], logger: silentLogger() }),
    ).rejects.toThrow(/apply mode requires a pgQuery/);
  });

  test('--tables flag restricts the work', async () => {
    const seen = [];
    const result = await runSync({
      apply: false,
      tables: ['stations', 'auth_users'],
      readTable: async (t) => {
        seen.push(t);
        return [];
      },
      logger: silentLogger(),
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual(['stations', 'auth_users']);
  });

  test('D1 read failure marks the table failed but continues', async () => {
    const pgQuery = vi.fn(async () => {});
    const result = await runSync({
      apply: true,
      tables: ['organizations', 'stations'],
      readTable: async (t) => {
        if (t === 'organizations') throw new Error('d1 read busted');
        return [];
      },
      pgQuery,
      logger: silentLogger(),
    });
    expect(result.ok).toBe(false);
    expect(result.report[0]).toMatchObject({
      table: 'organizations',
      ok: false,
      d1Count: null,
    });
    expect(result.report[1]).toMatchObject({
      table: 'stations',
      ok: true,
      d1Count: 0,
    });
  });
});

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}
