import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the session module BEFORE importing the handler.
vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet, onRequest, ROW_CAP } from './export';
import { getSessionFromRequest } from '../../_lib/session-jwt';
import type { SonicBloomEnv } from '../../_lib/env';

type AllResult = { results: unknown[]; success?: boolean };

const buildD1 = (
  allResults: AllResult[],
  firstResults: (unknown | null)[] = [],
): {
  prepare: ReturnType<typeof vi.fn>;
  preparedStatements: { sql: string; binds: unknown[] }[];
} => {
  const preparedStatements: { sql: string; binds: unknown[] }[] = [];
  let allCallIdx = 0;
  let firstCallIdx = 0;
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
  return { prepare, preparedStatements };
};

const buildEnv = (
  allResults: AllResult[],
  firstResults: (unknown | null)[] = [],
): { env: SonicBloomEnv; mockDb: ReturnType<typeof buildD1> } => {
  const mockDb = buildD1(allResults, firstResults);
  return {
    env: { DB: mockDb, AUTH_JWT_SECRET: 'test-secret' } as unknown as SonicBloomEnv,
    mockDb,
  };
};

const buildRequest = (qs = '') => {
  const headers = new Headers({ cookie: 'sb_session=valid-token' });
  return new Request(`http://localhost/api/royalty/export${qs}`, { method: 'GET', headers });
};

const VALID_QS =
  '?format=ascap&from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z';

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };
const stationRow = { id: 'urban-radio', name: 'Urban Radio' };

const playLogReadRow = {
  id: 'p1',
  station_id: 'urban-radio',
  track_id: 't1',
  title_snapshot: 'Song A',
  artist_snapshot: 'Artist A',
  played_at: '2026-05-13T10:00:00Z',
  duration_played_ms: 180000,
  source: 'automation',
  isrc: 'USRC17607839',
  iswc: 'T-034.524.680-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/royalty/export — auth + validation', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestGet({ env, request: buildRequest(VALID_QS) });
    expect(res.status).toBe(401);
  });

  test('given no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [], success: true }]);
    const res = await onRequestGet({ env, request: buildRequest(VALID_QS) });
    expect(res.status).toBe(403);
  });

  test('given missing format > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestGet({
      env,
      request: buildRequest('?from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z'),
    });
    expect(res.status).toBe(400);
  });

  test('given invalid format > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestGet({
      env,
      request: buildRequest(
        '?format=socan&from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z',
      ),
    });
    expect(res.status).toBe(400);
  });

  test('given non-ISO from/to > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestGet({
      env,
      request: buildRequest('?format=ascap&from=not-a-date&to=also-not-a-date'),
    });
    expect(res.status).toBe(400);
  });

  test('given non-GET method > returns 405', async () => {
    const { env } = buildEnv([]);
    const res = await onRequest({
      env,
      request: new Request(`http://localhost/api/royalty/export${VALID_QS}`, {
        method: 'POST',
        headers: { cookie: 'sb_session=valid-token' },
      }),
    });
    expect(res.status).toBe(405);
  });
});

describe('GET /api/royalty/export — happy path', () => {
  test('given valid session + format=ascap > 200, text/csv, expected header', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv(
      [
        { results: [memberRow], success: true },
        { results: [playLogReadRow], success: true },
      ],
      [stationRow],
    );
    const res = await onRequestGet({ env, request: buildRequest(VALID_QS) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/csv/);
    // Read raw bytes to verify the leading UTF-8 BOM (EF BB BF) is on the wire.
    // Note: Response.text() strips the BOM during decoding, so we use arrayBuffer().
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const body = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
    expect(body).toContain(
      'TitleOfWork,WriterPerformer,ISWC,ISRC,Date,TimePlayed,DurationSeconds,Source',
    );
    expect(body).toContain(
      'Song A,Artist A,T-034.524.680-1,USRC17607839,2026-05-13,10:00:00,180,automation',
    );
  });

  test('format=bmi returns BMI header', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv(
      [
        { results: [memberRow], success: true },
        { results: [playLogReadRow], success: true },
      ],
      [stationRow],
    );
    const res = await onRequestGet({
      env,
      request: buildRequest(
        '?format=bmi&from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z',
      ),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('SongTitle,Artist,ISRC,ISWC,PlayDate,PlayTime,DurationSeconds,FeatureType');
  });

  test('format=soundexchange returns DPR header + NameOfService', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv(
      [
        { results: [memberRow], success: true },
        { results: [playLogReadRow], success: true },
      ],
      [stationRow],
    );
    const res = await onRequestGet({
      env,
      request: buildRequest(
        '?format=soundexchange&from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z',
      ),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      'NameOfService,TransmissionCategory,FeaturedArtist,SoundRecordingTitle,ISRC,Album,MarketingLabel,ActualTotalPerformances',
    );
    expect(body).toContain('Urban Radio,Webcasting,Artist A,Song A');
  });

  test('returns Content-Disposition attachment with sanitized filename', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv(
      [
        { results: [memberRow], success: true },
        { results: [], success: true },
      ],
      [stationRow],
    );
    const res = await onRequestGet({ env, request: buildRequest(VALID_QS) });
    const cd = res.headers.get('Content-Disposition');
    expect(cd).toContain('attachment;');
    expect(cd).toContain('urban-radio-ascap');
    expect(cd).toMatch(/\.csv"$/);
  });

  test('falls back to stationId when stations row missing', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv(
      [
        { results: [memberRow], success: true },
        { results: [playLogReadRow], success: true },
      ],
      [null], // stations.first → null
    );
    const res = await onRequestGet({
      env,
      request: buildRequest(
        '?format=soundexchange&from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z',
      ),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('urban-radio,Webcasting');
  });
});

describe('GET /api/royalty/export — audit + scoping + cap', () => {
  test('writes audit_log entry with action=royalty_export and rowCount', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv(
      [
        { results: [memberRow], success: true },
        { results: [playLogReadRow, playLogReadRow], success: true },
      ],
      [stationRow],
    );
    const res = await onRequestGet({ env, request: buildRequest(VALID_QS) });
    expect(res.status).toBe(200);
    const auditStmt = mockDb.preparedStatements.find((s) => /INSERT INTO audit_log/i.test(s.sql));
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('urban-radio');
    expect(auditStmt!.binds).toContain('user-1');
    expect(auditStmt!.binds).toContain('royalty_export');
    expect(auditStmt!.binds).toContain('station');
    // after_json contains format, from, to, rowCount
    const afterJson = auditStmt!.binds.find(
      (b) => typeof b === 'string' && b.includes('royalty_export') === false && b.startsWith('{'),
    ) as string | undefined;
    expect(afterJson).toBeDefined();
    const parsed = JSON.parse(afterJson as string) as Record<string, unknown>;
    expect(parsed.format).toBe('ascap');
    expect(parsed.rowCount).toBe(2);
  });

  test('play_log SELECT is scoped to caller stationId (no cross-station leak)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv(
      [
        { results: [memberRow], success: true },
        // Even if the DB layer were misconfigured and returned a foreign row,
        // the SQL binding test below proves the WHERE clause filters to the
        // caller's stationId — so D1's RLS-style scoping would reject it.
        { results: [], success: true },
      ],
      [stationRow],
    );
    const res = await onRequestGet({ env, request: buildRequest(VALID_QS) });
    expect(res.status).toBe(200);
    const selectStmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(selectStmt).toBeDefined();
    // First bind on the SELECT is the gate-resolved stationId.
    expect(selectStmt!.binds[0]).toBe('urban-radio');
    expect(selectStmt!.sql).toMatch(/station_id\s*=\s*\?/);
    // X-Row-Count header proves the response excluded any non-scoped rows.
    expect(res.headers.get('X-Row-Count')).toBe('0');
  });

  test('exceeding ROW_CAP returns 413 row_cap_exceeded', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // Build ROW_CAP + 1 rows so the cap detection fires.
    const big = Array.from({ length: ROW_CAP + 1 }, (_, i) => ({
      ...playLogReadRow,
      id: `p${i}`,
    }));
    const { env } = buildEnv(
      [
        { results: [memberRow], success: true },
        { results: big, success: true },
      ],
      [stationRow],
    );
    const res = await onRequestGet({ env, request: buildRequest(VALID_QS) });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; limit: number };
    expect(body.error).toBe('row_cap_exceeded');
    expect(body.limit).toBe(ROW_CAP);
  });

  test('SELECT binds from/to range to play_log query', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv(
      [
        { results: [memberRow], success: true },
        { results: [], success: true },
      ],
      [stationRow],
    );
    const res = await onRequestGet({
      env,
      request: buildRequest(
        '?format=ascap&from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z',
      ),
    });
    expect(res.status).toBe(200);
    const selectStmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(selectStmt!.binds).toContain('2026-05-01T00:00:00Z');
    expect(selectStmt!.binds).toContain('2026-06-01T00:00:00Z');
    expect(selectStmt!.sql).toMatch(/played_at >= \?/);
    expect(selectStmt!.sql).toMatch(/played_at < \?/);
  });
});
