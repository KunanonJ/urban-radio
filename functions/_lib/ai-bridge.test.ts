import { describe, test, expect, vi, beforeEach } from 'vitest';

import { runAiCapability } from './ai-bridge';
import type { StationGateResult } from './require-station';
import type { AiResult } from '@/lib/ai';

type Bind = unknown;

interface MockStmt {
  sql: string;
  binds: Bind[];
  firstResult?: unknown;
  firstThrows?: boolean;
}

function buildD1(opts: {
  monthSpent?: number;
  monthSpentThrows?: boolean;
}) {
  const statements: MockStmt[] = [];
  const captured = { statements };
  const prepare = vi.fn((sql: string) => {
    const stmt: MockStmt = { sql, binds: [] };
    statements.push(stmt);
    const chain = {
      bind: (...args: Bind[]) => {
        stmt.binds.push(...args);
        return chain;
      },
      first: vi.fn().mockImplementation(() => {
        if (/FROM ai_usage/i.test(sql)) {
          if (opts.monthSpentThrows) return Promise.reject(new Error('boom'));
          return Promise.resolve({ total: opts.monthSpent ?? 0 });
        }
        return Promise.resolve(stmt.firstResult ?? null);
      }),
      all: vi.fn().mockResolvedValue({ results: [], success: true }),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    return chain;
  });
  const db = { prepare } as unknown as D1Database;
  return { db, captured };
}

const stationGate: StationGateResult = {
  ok: true,
  context: {
    userId: 'user-demo',
    username: 'demo',
    stationId: 'urban-radio',
    role: 'admin',
  },
};

function buildEnv(opts: Parameters<typeof buildD1>[0] = {}) {
  const { db, captured } = buildD1(opts);
  return { env: { DB: db } as { DB: D1Database }, captured };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runAiCapability', () => {
  test('given $0 month spent on starter plan > calls provider and returns 200', async () => {
    const { env, captured } = buildEnv({ monthSpent: 0 });
    // Plan resolution row: pretend org is on starter plan ($5 cap).
    // The bridge resolves the plan via a JOIN through stations → organizations.
    captured.statements; // touch to silence "unused"

    // Stub: provider returns ok.
    const run = vi.fn(async (): Promise<AiResult<{ greeting: string }>> => ({
      ok: true,
      provider: 'stub',
      data: { greeting: 'hi' },
      usage: { unit: 'tokens', count: 4, estimatedCostUsd: 0.0001 },
    }));

    // Plan query returns 'starter'. We intercept the plan row by replacing the prepare
    // mock's `first` for the plan SQL — easier: build a dedicated env.
    const dbWithPlan = {
      prepare: vi.fn((sql: string) => {
        const stmt = { sql };
        const chain = {
          bind: () => chain,
          first: () => {
            if (/FROM stations/i.test(sql)) return Promise.resolve({ plan: 'starter', org_id: 'default' });
            if (/FROM ai_usage/i.test(sql)) return Promise.resolve({ total: 0 });
            return Promise.resolve(null);
          },
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true }),
        };
        return chain;
      }),
    } as unknown as D1Database;

    const res = await runAiCapability(
      { DB: dbWithPlan },
      stationGate,
      {
        capability: 'text',
        estimatedCostUsd: 0.0001,
        run,
        requestSummary: 'hello world',
      },
    );

    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('stub');
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('given $50 month spent on starter plan ($5 cap) > returns 402 cap_hit', async () => {
    const dbCap = {
      prepare: vi.fn((sql: string) => {
        const chain = {
          bind: () => chain,
          first: () => {
            if (/FROM stations/i.test(sql)) return Promise.resolve({ plan: 'starter', org_id: 'default' });
            if (/FROM ai_usage/i.test(sql)) return Promise.resolve({ total: 50 });
            return Promise.resolve(null);
          },
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true }),
        };
        return chain;
      }),
    } as unknown as D1Database;

    const run = vi.fn();

    const res = await runAiCapability(
      { DB: dbCap },
      stationGate,
      {
        capability: 'text',
        estimatedCostUsd: 0.001,
        run,
      },
    );

    expect(res.status).toBe(402);
    const body = await readJson(res);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('cap_hit');
    expect(body.reason).toBe('monthly_cap_hit');
    expect(typeof body.remainingUsd).toBe('number');
    expect(run).not.toHaveBeenCalled();
  });

  test('given provider returns ok > inserts ai_usage row with reported usage', async () => {
    const inserts: { sql: string; binds: unknown[] }[] = [];
    const dbOk = {
      prepare: vi.fn((sql: string) => {
        const binds: unknown[] = [];
        const chain = {
          bind: (...args: unknown[]) => {
            binds.push(...args);
            if (/INSERT INTO ai_usage/i.test(sql)) {
              inserts.push({ sql, binds });
            }
            return chain;
          },
          first: () => {
            if (/FROM stations/i.test(sql)) return Promise.resolve({ plan: 'starter', org_id: 'default' });
            if (/FROM ai_usage/i.test(sql)) return Promise.resolve({ total: 0 });
            return Promise.resolve(null);
          },
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true }),
        };
        return chain;
      }),
    } as unknown as D1Database;

    await runAiCapability(
      { DB: dbOk },
      stationGate,
      {
        capability: 'voice',
        estimatedCostUsd: 0.01,
        run: async () => ({
          ok: true,
          provider: 'stub',
          data: { audioBase64: 'abc' },
          usage: { unit: 'characters', count: 42, estimatedCostUsd: 0.0126 },
        }),
      },
    );

    expect(inserts).toHaveLength(1);
    const insertBinds = inserts[0].binds;
    // Insert column order: id, org_id, station_id, actor_user_id, capability, provider, unit, count, estimated_cost_usd, request_summary
    expect(insertBinds[1]).toBe('default');
    expect(insertBinds[2]).toBe('urban-radio');
    expect(insertBinds[3]).toBe('user-demo');
    expect(insertBinds[4]).toBe('voice');
    expect(insertBinds[5]).toBe('stub');
    expect(insertBinds[6]).toBe('characters');
    expect(insertBinds[7]).toBe(42);
    expect(insertBinds[8]).toBe(0.0126);
  });

  test('given provider returns ok > writes audit_log', async () => {
    let auditWritten = false;
    const dbOk = {
      prepare: vi.fn((sql: string) => {
        const chain = {
          bind: () => {
            if (/INSERT INTO audit_log/i.test(sql)) auditWritten = true;
            return chain;
          },
          first: () => {
            if (/FROM stations/i.test(sql)) return Promise.resolve({ plan: 'starter', org_id: 'default' });
            if (/FROM ai_usage/i.test(sql)) return Promise.resolve({ total: 0 });
            return Promise.resolve(null);
          },
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true }),
        };
        return chain;
      }),
    } as unknown as D1Database;

    await runAiCapability(
      { DB: dbOk },
      stationGate,
      {
        capability: 'transcribe',
        estimatedCostUsd: 0.01,
        run: async () => ({
          ok: true,
          provider: 'stub',
          data: { foo: 'bar' },
          usage: { unit: 'seconds', count: 5, estimatedCostUsd: 0.0001 },
        }),
      },
    );

    expect(auditWritten).toBe(true);
  });

  test('given provider returns error > returns 502 with error message', async () => {
    const dbOk = {
      prepare: vi.fn((sql: string) => {
        const chain = {
          bind: () => chain,
          first: () => {
            if (/FROM stations/i.test(sql)) return Promise.resolve({ plan: 'starter', org_id: 'default' });
            if (/FROM ai_usage/i.test(sql)) return Promise.resolve({ total: 0 });
            return Promise.resolve(null);
          },
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true }),
        };
        return chain;
      }),
    } as unknown as D1Database;

    const res = await runAiCapability(
      { DB: dbOk },
      stationGate,
      {
        capability: 'anr',
        estimatedCostUsd: 0.01,
        run: async () => ({
          ok: false,
          provider: 'stub',
          error: 'No audio input provided.',
        }),
      },
    );

    expect(res.status).toBe(502);
    const body = await readJson(res);
    expect(body.ok).toBe(false);
    expect(body.error).toBe('No audio input provided.');
    expect(body.provider).toBe('stub');
  });

  test('given DB query for monthSpent fails > assumes 0 and proceeds', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const dbFlaky = {
      prepare: vi.fn((sql: string) => {
        const chain = {
          bind: () => chain,
          first: () => {
            if (/FROM stations/i.test(sql)) return Promise.resolve({ plan: 'pro', org_id: 'default' });
            if (/FROM ai_usage/i.test(sql)) return Promise.reject(new Error('db_error'));
            return Promise.resolve(null);
          },
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true }),
        };
        return chain;
      }),
    } as unknown as D1Database;

    const run = vi.fn(async () => ({
      ok: true as const,
      provider: 'stub' as const,
      data: { greeting: 'hi' },
      usage: { unit: 'tokens' as const, count: 1, estimatedCostUsd: 0 },
    }));

    const res = await runAiCapability(
      { DB: dbFlaky },
      stationGate,
      {
        capability: 'text',
        estimatedCostUsd: 0.001,
        run,
      },
    );

    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('start-of-month bind > uses YYYY-MM-01T00:00:00Z format', async () => {
    let monthCutoff: string | null = null;
    const dbWatch = {
      prepare: vi.fn((sql: string) => {
        const binds: unknown[] = [];
        const chain = {
          bind: (...args: unknown[]) => {
            binds.push(...args);
            if (/FROM ai_usage/i.test(sql) && /at >= /i.test(sql)) {
              monthCutoff = String(binds[1]);
            }
            return chain;
          },
          first: () => {
            if (/FROM stations/i.test(sql)) return Promise.resolve({ plan: 'pro', org_id: 'default' });
            if (/FROM ai_usage/i.test(sql)) return Promise.resolve({ total: 0 });
            return Promise.resolve(null);
          },
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true }),
        };
        return chain;
      }),
    } as unknown as D1Database;

    await runAiCapability(
      { DB: dbWatch },
      stationGate,
      {
        capability: 'text',
        estimatedCostUsd: 0.001,
        run: async () => ({
          ok: true,
          provider: 'stub',
          data: { foo: 'bar' },
          usage: { unit: 'tokens', count: 1, estimatedCostUsd: 0 },
        }),
      },
    );

    expect(monthCutoff).toMatch(/^\d{4}-\d{2}-01T00:00:00Z$/);
  });

  test('inserts request_summary truncated to 256 chars', async () => {
    const summaryInsertBinds: unknown[][] = [];
    const dbOk = {
      prepare: vi.fn((sql: string) => {
        const binds: unknown[] = [];
        const chain = {
          bind: (...args: unknown[]) => {
            binds.push(...args);
            if (/INSERT INTO ai_usage/i.test(sql)) {
              summaryInsertBinds.push(binds);
            }
            return chain;
          },
          first: () => {
            if (/FROM stations/i.test(sql)) return Promise.resolve({ plan: 'pro', org_id: 'default' });
            if (/FROM ai_usage/i.test(sql)) return Promise.resolve({ total: 0 });
            return Promise.resolve(null);
          },
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true }),
        };
        return chain;
      }),
    } as unknown as D1Database;

    const longSummary = 'x'.repeat(500);

    await runAiCapability(
      { DB: dbOk },
      stationGate,
      {
        capability: 'text',
        estimatedCostUsd: 0.001,
        run: async () => ({
          ok: true,
          provider: 'stub',
          data: { foo: 'bar' },
          usage: { unit: 'tokens', count: 1, estimatedCostUsd: 0 },
        }),
        requestSummary: longSummary,
      },
    );

    expect(summaryInsertBinds).toHaveLength(1);
    // request_summary is the 10th positional bind (column index 9).
    const summaryBind = summaryInsertBinds[0][9];
    expect(typeof summaryBind).toBe('string');
    expect((summaryBind as string).length).toBeLessThanOrEqual(256);
  });

  test('given station has no org row > returns 500', async () => {
    const dbNoOrg = {
      prepare: vi.fn((sql: string) => {
        const chain = {
          bind: () => chain,
          first: () => {
            if (/FROM stations/i.test(sql)) return Promise.resolve(null);
            return Promise.resolve(null);
          },
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true }),
        };
        return chain;
      }),
    } as unknown as D1Database;

    const res = await runAiCapability(
      { DB: dbNoOrg },
      stationGate,
      {
        capability: 'text',
        estimatedCostUsd: 0.001,
        run: vi.fn(),
      },
    );

    expect(res.status).toBe(500);
  });
});
