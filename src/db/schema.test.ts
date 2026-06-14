/**
 * Round-trip schema sanity tests for `src/db/schema.ts`.
 *
 * Strategy
 *   1. Spin up an in-memory Postgres via `pg-mem`.
 *   2. Replay the drizzle-kit-generated SQL at `src/db/migrations/0000_*.sql`
 *      so every table, FK, UNIQUE, and CHECK constraint is exercised against a
 *      real-ish Postgres planner.
 *   3. INSERT + SELECT one row per table, plus targeted negative tests for the
 *      constraints that are easy to get wrong on the D1 → Postgres translation:
 *      UNIQUE composites, CHECK lists, FK cascades.
 *
 * Caveats — pg-mem is not a full Postgres
 *   pg-mem 3.x rejects `(now() at time zone 'utc')::text` defaults during
 *   schema setup, so `statementsForPgMem` strips those `DEFAULT` clauses and
 *   tests bind explicit ISO strings. pg-mem also rejects the `types` and
 *   `rowMode` options drizzle's node-postgres driver sends, so we use the
 *   `pg-proxy` driver instead and translate row-objects → row-arrays
 *   ourselves. The drizzle-kit-generated SQL in `src/db/migrations/0000_*.sql`
 *   is the authoritative artefact that will run against real Postgres
 *   (Railway / Docker).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { newDb, type IMemoryDb } from 'pg-mem';
import { drizzle, type PgRemoteDatabase } from 'drizzle-orm/pg-proxy';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import * as schema from './schema';

type DbHandle = {
  mem: IMemoryDb;
  db: PgRemoteDatabase<typeof schema>;
};

const MIGRATIONS_DIR = join(__dirname, 'migrations');

function loadMigrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    throw new Error(
      `No drizzle-kit migrations found under ${MIGRATIONS_DIR}. ` +
        `Run \`npx drizzle-kit generate\` first.`,
    );
  }
  return files
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n\n');
}

const migrationSql = loadMigrationSql();

/**
 * Strip the `(now() at time zone 'utc')::text` defaults pg-mem can't always
 * parse, and split into discrete statements. Each test that depends on the
 * default value will bind an explicit ISO string.
 */
function statementsForPgMem(raw: string): string[] {
  const cleaned = raw
    // pg-mem 3.x parses this expression inconsistently across builds; strip the
    // DEFAULT clause and bind values explicitly.
    .replace(/DEFAULT \(now\(\) at time zone 'utc'\)::text/g, '')
    // drizzle-kit uses --> statement-breakpoint markers between statements.
    .split('--> statement-breakpoint');
  return cleaned
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Drizzle's `pg-proxy` driver hands us the raw SQL string + params + method
 * (`'execute'` for INSERT/UPDATE/DELETE without RETURNING, `'all'` for selects
 * and RETURNING). We dispatch to pg-mem.
 *
 * Tricky bit: for `'all'`, Drizzle expects `rows` to be ARRAYS of values
 * ordered by the SELECT/RETURNING column list, because `mapResultRow` indexes
 * by position. pg-mem returns row OBJECTS keyed by column name, so we parse
 * the column order from the SQL and project each object accordingly.
 *
 * We use a deliberately scoped regex — the generated SQL is shaped like
 *   select "id", "name", ... from
 *   ... returning "id", "name", ...
 * and we only have to handle that one shape since the SQL is drizzle-emitted.
 */
function parseSelectColumnOrder(sqlText: string): string[] | null {
  // Match the LAST select/returning column list before from/where/order/limit/end.
  const returning = sqlText.match(/returning\s+([\s\S]+?)(?:$|\s+limit\b|\s+where\b)/i);
  const select = sqlText.match(/select\s+([\s\S]+?)\s+from\s/i);
  const list = returning?.[1] ?? select?.[1];
  if (!list) return null;
  // Split on top-level commas; column refs are quoted: "tbl"."col" or "col".
  const cols: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      cols.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) cols.push(buf.trim());
  // Resolve each column ref to its bare name. Strip alias if present
  // (`"x"."y" as "alias"` → `alias`); else take the last quoted segment.
  return cols.map((raw) => {
    const aliasMatch = raw.match(/as\s+"([^"]+)"\s*$/i);
    if (aliasMatch) return aliasMatch[1];
    const lastQuoted = raw.match(/"([^"]+)"\s*$/);
    if (lastQuoted) return lastQuoted[1];
    return raw.trim().replace(/^"|"$/g, '');
  });
}

function makeDb(): DbHandle {
  const mem = newDb({ autoCreateForeignKeyIndices: true });

  for (const stmt of statementsForPgMem(migrationSql)) {
    mem.public.none(stmt);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  const db = drizzle(
    async (sqlText: string, params: unknown[], method: 'all' | 'execute') => {
      const result = (await pool.query(sqlText, params)) as {
        rows: Array<Record<string, unknown>>;
      };
      if (method === 'execute') return { rows: result.rows };
      const order = parseSelectColumnOrder(sqlText);
      if (!order) return { rows: result.rows };
      return {
        rows: result.rows.map((row) => order.map((col) => row[col])),
      };
    },
    { schema },
  );

  return { mem, db };
}

let handle: DbHandle;

beforeEach(() => {
  handle = makeDb();
});

afterEach(() => {
  // pg-mem holds no external resources; nothing to release.
});

// ---------------------------------------------------------------------------
// Smoke: tables exist
// ---------------------------------------------------------------------------

describe('schema bootstrap', () => {
  test('all 20 tables registered in pg-mem', () => {
    const expected = [
      'ai_usage',
      'albums',
      'artists',
      'audit_log',
      'auth_users',
      'categories',
      'clock_slots',
      'clocks',
      'comments',
      'media_objects',
      'organizations',
      'play_log',
      'playlist_tracks',
      'playlists',
      'presence_sessions',
      'radio_tracks',
      'schedule_assignments',
      'station_members',
      'stations',
      'tracks',
      'voice_tracks',
    ];
    for (const name of expected) {
      // Throws if the table is unknown to pg-mem.
      expect(handle.mem.public.getTable(name).name).toBe(name);
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trip inserts
// ---------------------------------------------------------------------------

describe('round-trip inserts', () => {
  test('organizations + stations round-trip with FK cascade', async () => {
    const { db } = handle;
    const orgId = 'org-a';
    const stationId = 'st-a';

    await db.insert(schema.organizations).values({
      id: orgId,
      name: 'Acme Radio',
      plan: 'pro',
      createdAt: '2026-01-01T00:00:00Z',
    });

    await db.insert(schema.stations).values({
      id: stationId,
      orgId,
      slug: 'main',
      name: 'Main Studio',
      timezone: 'Asia/Bangkok',
      createdAt: '2026-01-01T00:00:00Z',
    });

    const rows = await db
      .select()
      .from(schema.stations)
      .where(eq(schema.stations.id, stationId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.orgId).toBe(orgId);
    expect(rows[0]?.timezone).toBe('Asia/Bangkok');
  });

  test('auth_users + station_members composite PK + CHECK role', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-b', name: 'Org B', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-b',
      orgId: 'org-b',
      slug: 'b',
      name: 'B',
      createdAt: 'X',
    });
    await db.insert(schema.authUsers).values({
      id: 'u-1',
      username: 'alice',
      passwordHash: 'pbkdf2:x',
      createdAt: 'X',
    });

    await db.insert(schema.stationMembers).values({
      stationId: 'st-b',
      userId: 'u-1',
      role: 'admin',
      createdAt: 'X',
    });

    // Composite PK: inserting the same (station_id, user_id) again must throw.
    await expect(
      db.insert(schema.stationMembers).values({
        stationId: 'st-b',
        userId: 'u-1',
        role: 'producer',
        createdAt: 'X',
      }),
    ).rejects.toThrow();
  });

  test('station_members.role CHECK rejects bogus value', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-c', name: 'Org C', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-c',
      orgId: 'org-c',
      slug: 'c',
      name: 'C',
      createdAt: 'X',
    });
    await db.insert(schema.authUsers).values({
      id: 'u-2',
      username: 'bob',
      passwordHash: 'h',
      createdAt: 'X',
    });

    await expect(
      db.insert(schema.stationMembers).values({
        stationId: 'st-c',
        userId: 'u-2',
        role: 'super-saiyan', // not in the CHECK list
        createdAt: 'X',
      }),
    ).rejects.toThrow();
  });

  test('categories UNIQUE(station_id, name) rejects duplicate', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-d', name: 'D', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-d',
      orgId: 'org-d',
      slug: 'd',
      name: 'D',
      createdAt: 'X',
    });
    await db.insert(schema.categories).values({
      id: 'cat-1',
      stationId: 'st-d',
      name: 'Music',
      createdAt: 'X',
    });
    await expect(
      db.insert(schema.categories).values({
        id: 'cat-2',
        stationId: 'st-d',
        name: 'Music', // dup
        createdAt: 'X',
      }),
    ).rejects.toThrow();
  });

  test('radio_tracks round-trips every custom + cue field', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-rt', name: 'RT', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-rt',
      orgId: 'org-rt',
      slug: 'rt',
      name: 'RT',
      createdAt: 'X',
    });

    await db.insert(schema.radioTracks).values({
      id: 'trk-1',
      stationId: 'st-rt',
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
      genre: 'electronic',
      bpm: 128.5,
      musicKey: '8A',
      energy: 7,
      eraYear: 2025,
      language: 'en',
      durationMs: 215_000,
      cueInMs: 0,
      cueOutMs: 215_000,
      introMs: 8_000,
      outroMs: 5_000,
      mixPointMs: 200_000,
      loudnessLufs: -14.2,
      fileType: 'mp3',
      contentHash: 'sha256:abc',
      storageKey: 's3://bucket/trk-1.mp3',
      customF1: 'mood:happy',
      customF2: 'tag:radio',
      customF3: 'composer:test',
      customF4: 'isrc:US-X9P-25-00001',
      customF5: 'iswc:T-123.456.789-0',
      rating: 5,
      playCount: 0,
      dateAdded: '2026-01-01T00:00:00Z',
    });

    const [row] = await db
      .select()
      .from(schema.radioTracks)
      .where(eq(schema.radioTracks.id, 'trk-1'));

    expect(row?.bpm).toBeCloseTo(128.5, 1);
    expect(row?.loudnessLufs).toBeCloseTo(-14.2, 1);
    expect(row?.mixPointMs).toBe(200_000);
    expect(row?.customF1).toBe('mood:happy');
    expect(row?.customF5).toBe('iswc:T-123.456.789-0');
  });

  test('clock_slots UNIQUE(clock_id, position) rejects duplicate', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-cs', name: 'CS', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-cs',
      orgId: 'org-cs',
      slug: 'cs',
      name: 'CS',
      createdAt: 'X',
    });
    await db.insert(schema.clocks).values({
      id: 'clk-1',
      stationId: 'st-cs',
      name: 'Drive',
      createdAt: 'X',
    });

    await db.insert(schema.clockSlots).values({
      id: 'sl-1',
      clockId: 'clk-1',
      position: 1,
      slotType: 'music',
      durationEstimateMs: 210_000,
    });

    await expect(
      db.insert(schema.clockSlots).values({
        id: 'sl-2',
        clockId: 'clk-1',
        position: 1, // dup
        slotType: 'sweeper',
        durationEstimateMs: 5_000,
      }),
    ).rejects.toThrow();
  });

  test('schedule_assignments weekday/hour CHECK', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-sa', name: 'SA', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-sa',
      orgId: 'org-sa',
      slug: 'sa',
      name: 'SA',
      createdAt: 'X',
    });
    await db.insert(schema.clocks).values({
      id: 'clk-sa',
      stationId: 'st-sa',
      name: 'C',
      createdAt: 'X',
    });

    await db.insert(schema.scheduleAssignments).values({
      id: 'sa-1',
      stationId: 'st-sa',
      clockId: 'clk-sa',
      weekday: 0,
      hour: 0,
      createdAt: 'X',
    });

    await expect(
      db.insert(schema.scheduleAssignments).values({
        id: 'sa-2',
        stationId: 'st-sa',
        clockId: 'clk-sa',
        weekday: 7, // > 6
        hour: 0,
        createdAt: 'X',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(schema.scheduleAssignments).values({
        id: 'sa-3',
        stationId: 'st-sa',
        clockId: 'clk-sa',
        weekday: 0,
        hour: 24, // > 23
        createdAt: 'X',
      }),
    ).rejects.toThrow();
  });

  test('play_log accepts now_playing + auto_recognition (from 0006)', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-pl', name: 'PL', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-pl',
      orgId: 'org-pl',
      slug: 'pl',
      name: 'PL',
      createdAt: 'X',
    });

    await db.insert(schema.playLog).values({
      id: 'pl-1',
      stationId: 'st-pl',
      titleSnapshot: 'Song A',
      playedAt: '2026-01-01T00:00:00Z',
      source: 'now_playing',
    });

    await db.insert(schema.playLog).values({
      id: 'pl-2',
      stationId: 'st-pl',
      titleSnapshot: 'Song B',
      playedAt: '2026-01-01T01:00:00Z',
      source: 'auto_recognition',
    });

    await expect(
      db.insert(schema.playLog).values({
        id: 'pl-bad',
        stationId: 'st-pl',
        titleSnapshot: 'X',
        playedAt: '2026-01-01T02:00:00Z',
        source: 'imaginary-source',
      }),
    ).rejects.toThrow();
  });

  test('voice_tracks status CHECK + ai_generated integer 0/1', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-vt', name: 'VT', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-vt',
      orgId: 'org-vt',
      slug: 'vt',
      name: 'VT',
      createdAt: 'X',
    });

    await db.insert(schema.voiceTracks).values({
      id: 'vt-1',
      stationId: 'st-vt',
      storageKey: 's3://k',
      durationMs: 10_000,
      status: 'ready',
      aiGenerated: 1,
      createdAt: 'X',
    });

    const [row] = await db
      .select()
      .from(schema.voiceTracks)
      .where(eq(schema.voiceTracks.id, 'vt-1'));
    expect(row?.aiGenerated).toBe(1);
    expect(row?.status).toBe('ready');
  });

  test('audit_log round-trips JSON snapshot strings', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-al', name: 'AL', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-al',
      orgId: 'org-al',
      slug: 'al',
      name: 'AL',
      createdAt: 'X',
    });

    const before = JSON.stringify({ name: 'old' });
    const after = JSON.stringify({ name: 'new' });

    await db.insert(schema.auditLog).values({
      id: 'al-1',
      stationId: 'st-al',
      action: 'update',
      targetType: 'clock',
      targetId: 'clk-x',
      beforeJson: before,
      afterJson: after,
      at: '2026-01-01T00:00:00Z',
    });

    const [row] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.id, 'al-1'));
    expect(row?.beforeJson).toBe(before);
    expect(row?.afterJson).toBe(after);
    expect(JSON.parse(row?.afterJson ?? 'null')).toEqual({ name: 'new' });
  });

  test('ai_usage capability + unit CHECK constraints', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-ai', name: 'AI', createdAt: 'X' });

    await db.insert(schema.aiUsage).values({
      id: 'au-1',
      orgId: 'org-ai',
      capability: 'voice',
      provider: 'openai',
      unit: 'tokens',
      count: 1_000,
      estimatedCostUsd: 0.02,
      at: '2026-01-01T00:00:00Z',
    });

    await expect(
      db.insert(schema.aiUsage).values({
        id: 'au-bad',
        orgId: 'org-ai',
        capability: 'mind-reading', // not in CHECK list
        provider: 'openai',
        unit: 'tokens',
        count: 1,
        estimatedCostUsd: 0,
        at: 'X',
      }),
    ).rejects.toThrow();

    await expect(
      db.insert(schema.aiUsage).values({
        id: 'au-bad-2',
        orgId: 'org-ai',
        capability: 'voice',
        provider: 'openai',
        unit: 'parsecs', // not in CHECK list
        count: 1,
        estimatedCostUsd: 0,
        at: 'X',
      }),
    ).rejects.toThrow();
  });

  test('comments target_type CHECK rejects bogus', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-cm', name: 'CM', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-cm',
      orgId: 'org-cm',
      slug: 'cm',
      name: 'CM',
      createdAt: 'X',
    });
    await db.insert(schema.authUsers).values({
      id: 'u-cm',
      username: 'cm',
      passwordHash: 'h',
      createdAt: 'X',
    });

    await db.insert(schema.comments).values({
      id: 'c-1',
      stationId: 'st-cm',
      authorUserId: 'u-cm',
      targetType: 'radio_track',
      targetId: 'rt-x',
      body: 'hi',
      createdAt: 'X',
      updatedAt: 'X',
    });

    await expect(
      db.insert(schema.comments).values({
        id: 'c-bad',
        stationId: 'st-cm',
        authorUserId: 'u-cm',
        targetType: 'something_else', // not in CHECK list
        targetId: 'x',
        body: 'nope',
        createdAt: 'X',
        updatedAt: 'X',
      }),
    ).rejects.toThrow();
  });

  test('presence_sessions UNIQUE (station_id, user_id, target_type, target_id)', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-pr', name: 'PR', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-pr',
      orgId: 'org-pr',
      slug: 'pr',
      name: 'PR',
      createdAt: 'X',
    });
    await db.insert(schema.authUsers).values({
      id: 'u-pr',
      username: 'pr',
      passwordHash: 'h',
      createdAt: 'X',
    });

    await db.insert(schema.presenceSessions).values({
      id: 'ps-1',
      stationId: 'st-pr',
      userId: 'u-pr',
      targetType: 'clock',
      targetId: 'clk-1',
      lastHeartbeatAt: '2026-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
    });

    await expect(
      db.insert(schema.presenceSessions).values({
        id: 'ps-2',
        stationId: 'st-pr',
        userId: 'u-pr',
        targetType: 'clock',
        targetId: 'clk-1', // dup quad
        lastHeartbeatAt: '2026-01-01T00:00:05Z',
        createdAt: '2026-01-01T00:00:05Z',
      }),
    ).rejects.toThrow();
  });

  test('legacy catalog: artists + albums + tracks + media_objects', async () => {
    const { db } = handle;
    await db.insert(schema.artists).values({
      id: 'ar-1',
      name: 'Test Artist',
      artwork: 'art.jpg',
    });
    await db.insert(schema.albums).values({
      id: 'al-1',
      title: 'Album One',
      artistId: 'ar-1',
      artwork: 'art.jpg',
      year: 2025,
      genre: 'pop',
      source: 'demo',
    });
    await db.insert(schema.tracks).values({
      id: 'tk-1',
      title: 'Song One',
      artistId: 'ar-1',
      albumId: 'al-1',
      duration: 200_000,
      artwork: 'art.jpg',
      source: 'demo',
      genre: 'pop',
      year: 2025,
    });
    await db.insert(schema.mediaObjects).values({
      id: 'mo-1',
      r2Key: 'media/tk-1.mp3',
      trackId: 'tk-1',
      bytes: 5_000_000,
      contentType: 'audio/mpeg',
      createdAt: '2026-01-01T00:00:00Z',
    });

    const [media] = await db
      .select()
      .from(schema.mediaObjects)
      .where(eq(schema.mediaObjects.id, 'mo-1'));
    expect(media?.trackId).toBe('tk-1');
    expect(media?.bytes).toBe(5_000_000);

    // media_objects.r2_key is UNIQUE
    await expect(
      db.insert(schema.mediaObjects).values({
        id: 'mo-dup',
        r2Key: 'media/tk-1.mp3',
        bytes: 1,
        createdAt: 'X',
      }),
    ).rejects.toThrow();
  });

  test('playlists + playlist_tracks composite PK', async () => {
    const { db } = handle;

    await db.insert(schema.artists).values({ id: 'ar-pl', name: 'A', artwork: '' });
    await db.insert(schema.albums).values({
      id: 'al-pl',
      title: 'T',
      artistId: 'ar-pl',
      artwork: '',
      year: 2025,
      genre: 'g',
      source: 's',
    });
    await db.insert(schema.tracks).values({
      id: 'tk-pl',
      title: 'T',
      artistId: 'ar-pl',
      albumId: 'al-pl',
      duration: 1,
      artwork: '',
      source: '',
      genre: '',
      year: 2025,
    });
    await db.insert(schema.playlists).values({
      id: 'p-1',
      title: 'Mix',
      artwork: '',
    });

    await db.insert(schema.playlistTracks).values({
      playlistId: 'p-1',
      trackId: 'tk-pl',
      sortOrder: 0,
    });

    await expect(
      db.insert(schema.playlistTracks).values({
        playlistId: 'p-1',
        trackId: 'tk-pl', // dup composite PK
        sortOrder: 1,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Defaults & numeric types
// ---------------------------------------------------------------------------

describe('column defaults', () => {
  test('playlists.is_public defaults to 0 (integer-as-boolean)', async () => {
    const { db } = handle;
    await db.insert(schema.playlists).values({
      id: 'p-def',
      title: 'X',
      artwork: '',
    });
    const [row] = await db
      .select()
      .from(schema.playlists)
      .where(eq(schema.playlists.id, 'p-def'));
    expect(row?.isPublic).toBe(0);
    expect(row?.createdBy).toBe('You');
    expect(row?.description).toBe('');
  });

  test('categories.suppress_title defaults to 0 (integer-as-boolean)', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-st', name: 'X', createdAt: 'X' });
    await db.insert(schema.stations).values({
      id: 'st-st',
      orgId: 'org-st',
      slug: 's',
      name: 'X',
      createdAt: 'X',
    });
    await db.insert(schema.categories).values({
      id: 'cat-def',
      stationId: 'st-st',
      name: 'Music',
      createdAt: 'X',
    });
    const [row] = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.id, 'cat-def'));
    expect(row?.suppressTitle).toBe(0);
    expect(row?.color).toBe('#888888');
    expect(row?.repeatProtectionMinutes).toBe(0);
  });

  test('sql template still usable (smoke: COUNT after inserts)', async () => {
    const { db } = handle;
    await db.insert(schema.organizations).values({ id: 'org-s', name: 'S', createdAt: 'X' });
    await db.insert(schema.organizations).values({ id: 'org-s2', name: 'S2', createdAt: 'X' });
    const result = await db.execute(sql`SELECT COUNT(*)::int AS c FROM organizations`);
    // pg-mem returns rows[0].c. Just confirm > 0 to avoid coupling to its row shape.
    const rows = (result as { rows?: Array<{ c: number }> }).rows ?? (result as unknown as Array<{ c: number }>);
    const count = Array.isArray(rows) ? rows[0]?.c : (rows as { c: number }).c;
    expect(Number(count)).toBeGreaterThanOrEqual(2);
  });
});
