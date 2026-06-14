import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PRE_0008_MIGRATIONS = [
  '0001_init.sql',
  '0002_seed.sql',
  '0003_auth_users.sql',
  '0004_radio_schema.sql',
  '0005_default_org_station.sql',
  '0006_ai_usage_and_play_log_check.sql',
  '0007_comments.sql',
];

const MIGRATION_0008 = '0008_presence.sql';

function loadSql(filename: string): string {
  return readFileSync(join(__dirname, filename), 'utf8');
}

function runSqlFile(db: Database.Database, filename: string): void {
  // Apply a migration SQL file in-memory (no shell, just SQLite).
  const ddl = loadSql(filename);
  (db as unknown as { exec: (sql: string) => void }).exec(ddl);
}

function freshDbAfter0008(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of PRE_0008_MIGRATIONS) {
    runSqlFile(db, m);
  }
  runSqlFile(db, MIGRATION_0008);
  return db;
}

function seedUserAndStation(db: Database.Database, userId = 'user-1'): void {
  db.prepare(
    "INSERT OR IGNORE INTO auth_users (id, username, password_hash) VALUES (?, ?, 'hash')",
  ).run(userId, userId);
  db.prepare(
    "INSERT OR IGNORE INTO station_members (station_id, user_id, role) VALUES ('urban-radio', ?, 'admin')",
  ).run(userId);
}

describe('0008_presence migration', () => {
  test('presence_sessions table created with expected columns', () => {
    const db = freshDbAfter0008();
    const cols = db
      .prepare("PRAGMA table_info('presence_sessions')")
      .all() as { name: string; type: string; notnull: number }[];
    expect(cols.length).toBeGreaterThan(0);
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'station_id',
        'user_id',
        'target_type',
        'target_id',
        'last_heartbeat_at',
        'created_at',
      ]),
    );

    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='presence_sessions'",
      )
      .all() as { name: string }[];
    const idxNames = indexes.map((i) => i.name);
    expect(idxNames).toEqual(
      expect.arrayContaining(['idx_presence_target', 'idx_presence_user_target']),
    );
  });

  test('rejects unknown target_type via CHECK', () => {
    const db = freshDbAfter0008();
    seedUserAndStation(db);
    expect(() =>
      db
        .prepare(
          "INSERT INTO presence_sessions (id, station_id, user_id, target_type, target_id) " +
            "VALUES ('p-bad', 'urban-radio', 'user-1', 'mystery-thing', 'x')",
        )
        .run(),
    ).toThrow();
  });

  test('all 6 target_type values are accepted', () => {
    const db = freshDbAfter0008();
    seedUserAndStation(db);
    const types = [
      'clock',
      'clock_slot',
      'schedule_assignment',
      'voice_track',
      'radio_track',
      'schedule_cell',
    ];
    for (const [i, t] of types.entries()) {
      db.prepare(
        "INSERT INTO presence_sessions (id, station_id, user_id, target_type, target_id) " +
          "VALUES (?, 'urban-radio', 'user-1', ?, ?)",
      ).run(`p-${i}`, t, `tgt-${i}`);
    }
    const count = (
      db.prepare('SELECT COUNT(*) AS c FROM presence_sessions').get() as { c: number }
    ).c;
    expect(count).toBe(types.length);
  });

  test('cascade delete on station_id removes presence rows', () => {
    const db = freshDbAfter0008();
    seedUserAndStation(db);
    db.prepare(
      "INSERT INTO presence_sessions (id, station_id, user_id, target_type, target_id) " +
        "VALUES ('p-1', 'urban-radio', 'user-1', 'clock', 'clk-1')",
    ).run();
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM presence_sessions WHERE id='p-1'")
          .get() as { c: number }
      ).c,
    ).toBe(1);
    db.prepare("DELETE FROM stations WHERE id='urban-radio'").run();
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM presence_sessions WHERE id='p-1'")
          .get() as { c: number }
      ).c,
    ).toBe(0);
  });

  test('unique index on (station, user, target_type, target_id) — second INSERT fails without ON CONFLICT', () => {
    const db = freshDbAfter0008();
    seedUserAndStation(db);
    db.prepare(
      "INSERT INTO presence_sessions (id, station_id, user_id, target_type, target_id) " +
        "VALUES ('p-1', 'urban-radio', 'user-1', 'clock', 'clk-1')",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO presence_sessions (id, station_id, user_id, target_type, target_id) " +
            "VALUES ('p-2', 'urban-radio', 'user-1', 'clock', 'clk-1')",
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });

  test('ON CONFLICT DO UPDATE upserts last_heartbeat_at on duplicate (station, user, target)', () => {
    const db = freshDbAfter0008();
    seedUserAndStation(db);
    db.prepare(
      "INSERT INTO presence_sessions (id, station_id, user_id, target_type, target_id, last_heartbeat_at) " +
        "VALUES ('p-1', 'urban-radio', 'user-1', 'clock', 'clk-1', '2026-05-14T10:00:00Z')",
    ).run();

    // Simulate the upsert pattern the production code will use.
    db.prepare(
      "INSERT INTO presence_sessions (id, station_id, user_id, target_type, target_id, last_heartbeat_at) " +
        "VALUES ('p-2', 'urban-radio', 'user-1', 'clock', 'clk-1', '2026-05-14T10:00:05Z') " +
        "ON CONFLICT(station_id, user_id, target_type, target_id) DO UPDATE SET " +
        "last_heartbeat_at = excluded.last_heartbeat_at",
    ).run();

    const rows = db
      .prepare(
        "SELECT id, last_heartbeat_at FROM presence_sessions WHERE station_id=? AND user_id=? AND target_type=? AND target_id=?",
      )
      .all('urban-radio', 'user-1', 'clock', 'clk-1') as {
      id: string;
      last_heartbeat_at: string;
    }[];
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('p-1'); // original id preserved
    expect(rows[0].last_heartbeat_at).toBe('2026-05-14T10:00:05Z');
  });

  test('two different users on the same target both have rows (station-scoped multi-user)', () => {
    const db = freshDbAfter0008();
    seedUserAndStation(db, 'user-1');
    seedUserAndStation(db, 'user-2');
    db.prepare(
      "INSERT INTO presence_sessions (id, station_id, user_id, target_type, target_id) " +
        "VALUES ('p-1', 'urban-radio', 'user-1', 'clock', 'clk-1')",
    ).run();
    db.prepare(
      "INSERT INTO presence_sessions (id, station_id, user_id, target_type, target_id) " +
        "VALUES ('p-2', 'urban-radio', 'user-2', 'clock', 'clk-1')",
    ).run();
    const count = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM presence_sessions WHERE station_id=? AND target_type=? AND target_id=?",
        )
        .get('urban-radio', 'clock', 'clk-1') as { c: number }
    ).c;
    expect(count).toBe(2);
  });

  test('NOT NULL constraints on required columns', () => {
    const db = freshDbAfter0008();
    seedUserAndStation(db);
    // missing target_id
    expect(() =>
      db
        .prepare(
          "INSERT INTO presence_sessions (id, station_id, user_id, target_type) " +
            "VALUES ('p-1', 'urban-radio', 'user-1', 'clock')",
        )
        .run(),
    ).toThrow();
    // missing user_id
    expect(() =>
      db
        .prepare(
          "INSERT INTO presence_sessions (id, station_id, target_type, target_id) " +
            "VALUES ('p-2', 'urban-radio', 'clock', 'clk-1')",
        )
        .run(),
    ).toThrow();
  });
});
