/**
 * Tests for the Drizzle client factory.
 *
 * We mock `pg.Pool` so the suite never opens a TCP connection — these tests
 * verify the factory's branching logic (env var, override, explicit pool,
 * cache behavior), not Postgres itself.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

// Capture every Pool constructor call so we can assert on its config.
const poolInstances: Array<Record<string, unknown>> = [];

vi.mock('pg', () => {
  const PoolMock = vi.fn().mockImplementation((cfg: Record<string, unknown>) => {
    const instance = { __mockPool: true as const, config: cfg };
    poolInstances.push(instance);
    return instance;
  });
  return { Pool: PoolMock, default: { Pool: PoolMock } };
});

// drizzle returns a sentinel referencing the pool it was given, so we can
// verify both that drizzle was called and which pool flowed through.
const drizzleSpy = vi.fn(
  (client: unknown, opts?: unknown) =>
    ({ __drizzle: true as const, client, opts }) as const,
);
vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: (client: unknown, opts?: unknown) => drizzleSpy(client, opts),
}));

// Stub the schema barrel so this test file can run before the parallel
// schema agent has shipped src/db/schema.ts. The mock satisfies vite's
// resolver while leaving production imports of './schema' untouched.
vi.mock('./schema', () => ({}));

// Import AFTER the mocks are registered.
import { Pool } from 'pg';
import { __resetDbCacheForTests, createDb, getDb } from './client';

beforeEach(() => {
  poolInstances.length = 0;
  drizzleSpy.mockClear();
  (Pool as unknown as { mockClear: () => void }).mockClear();
  delete process.env.DATABASE_URL;
  __resetDbCacheForTests();
});

describe('createDb', () => {
  test('createDb > given DATABASE_URL env var > constructs a Pool with that URL', () => {
    process.env.DATABASE_URL = 'postgresql://envuser:pw@host:5432/db';

    createDb();

    expect(Pool).toHaveBeenCalledTimes(1);
    expect(poolInstances).toHaveLength(1);
    expect(poolInstances[0]?.config).toMatchObject({
      connectionString: 'postgresql://envuser:pw@host:5432/db',
      max: 10,
    });
  });

  test('createDb > given explicit url option > overrides the env var', () => {
    process.env.DATABASE_URL = 'postgresql://ignored:pw@host/ignored';

    createDb({ url: 'postgresql://chosen:pw@host:5432/chosen_db' });

    expect(poolInstances[0]?.config).toMatchObject({
      connectionString: 'postgresql://chosen:pw@host:5432/chosen_db',
    });
  });

  test('createDb > given explicit pool option > skips Pool construction entirely', () => {
    const externalPool = { __externalPool: true } as unknown as InstanceType<typeof Pool>;

    const db = createDb({ pool: externalPool });

    expect(Pool).not.toHaveBeenCalled();
    expect(drizzleSpy).toHaveBeenCalledTimes(1);
    expect(drizzleSpy.mock.calls[0]?.[0]).toBe(externalPool);
    expect(db).toMatchObject({ __drizzle: true, client: externalPool });
  });

  test('createDb > given max option > forwards pool size to the Pool config', () => {
    createDb({ url: 'postgresql://u:p@h/db', max: 25 });

    expect(poolInstances[0]?.config).toMatchObject({
      connectionString: 'postgresql://u:p@h/db',
      max: 25,
    });
  });

  test('createDb > given no url and no env var and no pool > throws a helpful error', () => {
    expect(() => createDb()).toThrowError(/DATABASE_URL is not set/);
  });
});

describe('getDb', () => {
  test('getDb > given missing DATABASE_URL > throws a helpful error', () => {
    expect(() => getDb()).toThrowError(/DATABASE_URL is not set/);
  });

  test('getDb > given DATABASE_URL > caches the client across calls', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db';

    const a = getDb();
    const b = getDb();

    expect(a).toBe(b);
    // Only ONE pool / drizzle construction should happen across both calls.
    expect(Pool).toHaveBeenCalledTimes(1);
    expect(drizzleSpy).toHaveBeenCalledTimes(1);
  });

  test('__resetDbCacheForTests > clears the cache so the next getDb rebuilds', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db';

    const a = getDb();
    __resetDbCacheForTests();
    const b = getDb();

    expect(a).not.toBe(b);
    expect(Pool).toHaveBeenCalledTimes(2);
  });
});
