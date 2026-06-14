import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Migrations applied in numbered order before 0006. The 0006 migration is applied
 * inside the freshDb helper so individual tests can also re-run it for the
 * "preserves existing rows" scenario.
 */
const PRE_0006_MIGRATIONS = [
  '0001_init.sql',
  '0002_seed.sql',
  '0003_auth_users.sql',
  '0004_radio_schema.sql',
  '0005_default_org_station.sql',
];

const MIGRATION_0006 = '0006_ai_usage_and_play_log_check.sql';

function loadSql(filename: string): string {
  return readFileSync(join(__dirname, filename), 'utf8');
}

function applySqlFile(db: Database.Database, filename: string): void {
  db.exec(loadSql(filename));
}

function freshDbBefore0006(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of PRE_0006_MIGRATIONS) {
    applySqlFile(db, m);
  }
  return db;
}

function freshDbAfter0006(): Database.Database {
  const db = freshDbBefore0006();
  applySqlFile(db, MIGRATION_0006);
  return db;
}

describe('0006_ai_usage_and_play_log_check migration', () => {
  test('ai_usage table created with the right columns', () => {
    const db = freshDbAfter0006();
    const cols = db
      .prepare("PRAGMA table_info('ai_usage')")
      .all() as { name: string; type: string; notnull: number }[];

    expect(cols.length).toBeGreaterThan(0);
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'org_id',
        'station_id',
        'actor_user_id',
        'capability',
        'provider',
        'unit',
        'count',
        'estimated_cost_usd',
        'request_summary',
        'at',
      ]),
    );

    // Indexes exist for monthly rollup queries.
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='ai_usage'")
      .all() as { name: string }[];
    const idxNames = indexes.map((i) => i.name);
    expect(idxNames).toEqual(
      expect.arrayContaining(['idx_ai_usage_org_at', 'idx_ai_usage_station_at']),
    );
  });

  test('ai_usage rejects unknown capability via CHECK', () => {
    const db = freshDbAfter0006();
    expect(() =>
      db
        .prepare(
          "INSERT INTO ai_usage (id, org_id, station_id, capability, provider, unit, count, estimated_cost_usd) " +
            "VALUES ('u1', 'default', 'urban-radio', 'not-a-capability', 'stub', 'tokens', 1, 0.0001)",
        )
        .run(),
    ).toThrow();
  });

  test('ai_usage rejects unknown unit via CHECK', () => {
    const db = freshDbAfter0006();
    expect(() =>
      db
        .prepare(
          "INSERT INTO ai_usage (id, org_id, station_id, capability, provider, unit, count, estimated_cost_usd) " +
            "VALUES ('u1', 'default', 'urban-radio', 'voice', 'stub', 'cabbages', 1, 0.0001)",
        )
        .run(),
    ).toThrow();
  });

  test('ai_usage accepts a well-formed row', () => {
    const db = freshDbAfter0006();
    db.prepare(
      "INSERT INTO ai_usage (id, org_id, station_id, actor_user_id, capability, provider, unit, count, estimated_cost_usd, request_summary) " +
        "VALUES ('u1', 'default', 'urban-radio', 'user-demo', 'text', 'stub', 'tokens', 17, 0.0001, 'hello')",
    ).run();
    const row = db
      .prepare("SELECT capability, provider, count FROM ai_usage WHERE id='u1'")
      .get() as { capability: string; provider: string; count: number };
    expect(row.capability).toBe('text');
    expect(row.provider).toBe('stub');
    expect(row.count).toBe(17);
  });

  test("play_log accepts source='now_playing' after migration", () => {
    const db = freshDbAfter0006();
    expect(() =>
      db
        .prepare(
          "INSERT INTO play_log (id, station_id, title_snapshot, played_at, source) " +
            "VALUES ('pl1', 'urban-radio', 'Live song', datetime('now'), 'now_playing')",
        )
        .run(),
    ).not.toThrow();
    const row = db
      .prepare("SELECT source FROM play_log WHERE id='pl1'")
      .get() as { source: string };
    expect(row.source).toBe('now_playing');
  });

  test("play_log accepts source='auto_recognition' after migration", () => {
    const db = freshDbAfter0006();
    expect(() =>
      db
        .prepare(
          "INSERT INTO play_log (id, station_id, title_snapshot, played_at, source) " +
            "VALUES ('pl2', 'urban-radio', 'ANR detected song', datetime('now'), 'auto_recognition')",
        )
        .run(),
    ).not.toThrow();
  });

  test("play_log still accepts existing source values (e.g. 'automation')", () => {
    const db = freshDbAfter0006();
    expect(() =>
      db
        .prepare(
          "INSERT INTO play_log (id, station_id, title_snapshot, played_at, source) " +
            "VALUES ('pl3', 'urban-radio', 'Automation row', datetime('now'), 'automation')",
        )
        .run(),
    ).not.toThrow();
  });

  test('play_log rejects an unknown source after migration', () => {
    const db = freshDbAfter0006();
    expect(() =>
      db
        .prepare(
          "INSERT INTO play_log (id, station_id, title_snapshot, played_at, source) " +
            "VALUES ('plBad', 'urban-radio', 'Bad', datetime('now'), 'not-allowed')",
        )
        .run(),
    ).toThrow();
  });

  test('play_log preserves existing rows after constraint update', () => {
    const db = freshDbBefore0006();
    db.prepare(
      "INSERT INTO play_log (id, station_id, title_snapshot, played_at, source) " +
        "VALUES ('keep-1', 'urban-radio', 'Old row', '2026-05-01T00:00:00Z', 'automation')",
    ).run();
    db.prepare(
      "INSERT INTO play_log (id, station_id, title_snapshot, artist_snapshot, played_at, duration_played_ms, source, isrc) " +
        "VALUES ('keep-2', 'urban-radio', 'Live DJ track', 'Some Artist', '2026-05-01T01:00:00Z', 12345, 'live_dj', 'TESTISRC0001')",
    ).run();

    const beforeCount = (
      db.prepare('SELECT COUNT(*) AS c FROM play_log').get() as { c: number }
    ).c;
    expect(beforeCount).toBe(2);

    applySqlFile(db, MIGRATION_0006);

    const afterRows = db
      .prepare("SELECT id, source, isrc, artist_snapshot FROM play_log ORDER BY id")
      .all() as { id: string; source: string; isrc: string | null; artist_snapshot: string | null }[];
    expect(afterRows).toHaveLength(2);
    expect(afterRows[0].id).toBe('keep-1');
    expect(afterRows[0].source).toBe('automation');
    expect(afterRows[1].id).toBe('keep-2');
    expect(afterRows[1].source).toBe('live_dj');
    expect(afterRows[1].isrc).toBe('TESTISRC0001');
    expect(afterRows[1].artist_snapshot).toBe('Some Artist');
  });

  test('play_log indexes recreated after rename', () => {
    const db = freshDbAfter0006();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='play_log'")
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toEqual(
      expect.arrayContaining(['idx_play_log_station_played_at', 'idx_play_log_track']),
    );
  });
});
