import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PRE_0007_MIGRATIONS = [
  '0001_init.sql',
  '0002_seed.sql',
  '0003_auth_users.sql',
  '0004_radio_schema.sql',
  '0005_default_org_station.sql',
  '0006_ai_usage_and_play_log_check.sql',
];

const MIGRATION_0007 = '0007_comments.sql';

function loadSql(filename: string): string {
  return readFileSync(join(__dirname, filename), 'utf8');
}

function applySqlFile(db: Database.Database, filename: string): void {
  db.exec(loadSql(filename));
}

function freshDbAfter0007(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of PRE_0007_MIGRATIONS) {
    applySqlFile(db, m);
  }
  applySqlFile(db, MIGRATION_0007);
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

describe('0007_comments migration', () => {
  test('comments table created with expected columns and indexes', () => {
    const db = freshDbAfter0007();
    const cols = db
      .prepare("PRAGMA table_info('comments')")
      .all() as { name: string; type: string; notnull: number }[];
    expect(cols.length).toBeGreaterThan(0);
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'station_id',
        'author_user_id',
        'target_type',
        'target_id',
        'body',
        'resolved_at',
        'resolved_by_user_id',
        'created_at',
        'updated_at',
      ]),
    );

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='comments'")
      .all() as { name: string }[];
    const idxNames = indexes.map((i) => i.name);
    expect(idxNames).toEqual(
      expect.arrayContaining(['idx_comments_target', 'idx_comments_author']),
    );
  });

  test('comments target_type CHECK rejects unknown values', () => {
    const db = freshDbAfter0007();
    seedUserAndStation(db);
    expect(() =>
      db
        .prepare(
          "INSERT INTO comments (id, station_id, author_user_id, target_type, target_id, body) " +
            "VALUES ('c-bad', 'urban-radio', 'user-1', 'mystery-thing', 'x', 'nope')",
        )
        .run(),
    ).toThrow();
  });

  test('comments scoped by station_id with cascade', () => {
    const db = freshDbAfter0007();
    seedUserAndStation(db);
    db.prepare(
      "INSERT INTO comments (id, station_id, author_user_id, target_type, target_id, body) " +
        "VALUES ('c-1', 'urban-radio', 'user-1', 'clock', 'clk-1', 'hello')",
    ).run();

    const beforeRow = db
      .prepare("SELECT station_id, target_type, body FROM comments WHERE id='c-1'")
      .get() as { station_id: string; target_type: string; body: string };
    expect(beforeRow.station_id).toBe('urban-radio');
    expect(beforeRow.target_type).toBe('clock');
    expect(beforeRow.body).toBe('hello');

    db.prepare("DELETE FROM stations WHERE id='urban-radio'").run();
    const afterCount = (
      db.prepare("SELECT COUNT(*) AS c FROM comments WHERE id='c-1'").get() as { c: number }
    ).c;
    expect(afterCount).toBe(0);
  });

  test('comments INSERT requires body + target_id (NOT NULL)', () => {
    const db = freshDbAfter0007();
    seedUserAndStation(db);
    expect(() =>
      db
        .prepare(
          "INSERT INTO comments (id, station_id, author_user_id, target_type, target_id) " +
            "VALUES ('c-2', 'urban-radio', 'user-1', 'clock', 'clk-1')",
        )
        .run(),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          "INSERT INTO comments (id, station_id, author_user_id, target_type, body) " +
            "VALUES ('c-3', 'urban-radio', 'user-1', 'clock', 'hello')",
        )
        .run(),
    ).toThrow();
  });

  test('idx_comments_target supports (station_id, target_type, target_id, created_at DESC) ordering', () => {
    const db = freshDbAfter0007();
    seedUserAndStation(db);
    db.prepare(
      "INSERT INTO comments (id, station_id, author_user_id, target_type, target_id, body, created_at) " +
        "VALUES ('c-a', 'urban-radio', 'user-1', 'clock_slot', 'slot-9', 'first', '2026-05-13T10:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO comments (id, station_id, author_user_id, target_type, target_id, body, created_at) " +
        "VALUES ('c-b', 'urban-radio', 'user-1', 'clock_slot', 'slot-9', 'second', '2026-05-13T11:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO comments (id, station_id, author_user_id, target_type, target_id, body, created_at) " +
        "VALUES ('c-c', 'urban-radio', 'user-1', 'clock_slot', 'slot-9', 'third', '2026-05-13T12:00:00Z')",
    ).run();

    const rows = db
      .prepare(
        "SELECT id, created_at FROM comments " +
          "WHERE station_id=? AND target_type=? AND target_id=? " +
          "ORDER BY created_at DESC, id DESC",
      )
      .all('urban-radio', 'clock_slot', 'slot-9') as { id: string; created_at: string }[];
    expect(rows.map((r) => r.id)).toEqual(['c-c', 'c-b', 'c-a']);
  });

  test('all 5 target_type values are accepted', () => {
    const db = freshDbAfter0007();
    seedUserAndStation(db);
    const types = ['clock', 'clock_slot', 'schedule_assignment', 'voice_track', 'radio_track'];
    for (const [i, t] of types.entries()) {
      db.prepare(
        "INSERT INTO comments (id, station_id, author_user_id, target_type, target_id, body) " +
          "VALUES (?, 'urban-radio', 'user-1', ?, 'tgt', 'ok')",
      ).run(`c-${i}`, t);
    }
    const count = (
      db.prepare('SELECT COUNT(*) AS c FROM comments').get() as { c: number }
    ).c;
    expect(count).toBe(types.length);
  });
});
