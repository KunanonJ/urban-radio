import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS = [
  '0001_init.sql',
  '0002_seed.sql',
  '0003_auth_users.sql',
  '0004_radio_schema.sql',
  '0005_default_org_station.sql',
];

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) {
    const sql = readFileSync(join(__dirname, m), 'utf8');
    db.exec(sql);
  }
  return db;
}

describe('0005_default_org_station migration', () => {
  test('given fresh D1 > creates one org row "default"', () => {
    const db = freshDb();
    const row = db.prepare("SELECT id FROM organizations WHERE id='default'").get();
    expect(row).toBeDefined();
  });

  test('given fresh D1 > creates station urban-radio', () => {
    const db = freshDb();
    const row = db
      .prepare("SELECT slug, name FROM stations WHERE id='urban-radio'")
      .get() as { slug: string; name: string };
    expect(row.slug).toBe('urban-radio');
    expect(row.name).toBe('Urban Radio');
  });

  test('given demo user present > links them as admin', () => {
    const db = freshDb();
    const row = db
      .prepare(
        `SELECT sm.role FROM station_members sm
         JOIN auth_users au ON au.id = sm.user_id
         WHERE sm.station_id='urban-radio' AND au.username='demo'`
      )
      .get() as { role: string } | undefined;
    expect(row?.role).toBe('admin');
  });

  test('given fresh D1 > seeds 5 categories on urban-radio', () => {
    const db = freshDb();
    const rows = db
      .prepare("SELECT name FROM categories WHERE station_id='urban-radio'")
      .all();
    expect(rows).toHaveLength(5);
  });

  test('rerunning migration > produces no duplicates', () => {
    const db = freshDb();
    const before = db
      .prepare('SELECT COUNT(*) as c FROM organizations')
      .get() as { c: number };
    const sql = readFileSync(
      join(__dirname, '0005_default_org_station.sql'),
      'utf8'
    );
    db.exec(sql);
    const after = db
      .prepare('SELECT COUNT(*) as c FROM organizations')
      .get() as { c: number };
    expect(after.c).toBe(before.c);
  });
});
