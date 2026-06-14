/**
 * Unit tests for the pure helpers in `backup-pg-to-s3.mjs`.
 *
 * We don't exercise pg_dump or the AWS SDK end-to-end here — those are
 * integration tests against real services. Just verify the key-building,
 * env-resolution, and retention-window math.
 */

import { describe, expect, test, vi } from 'vitest';

import { buildObjectKey, pruneOldBackups } from './backup-pg-to-s3.mjs';

describe('buildObjectKey', () => {
  test('uses default prefix and ISO-stamped filename', () => {
    const key = buildObjectKey({
      now: new Date('2026-05-16T10:30:45.123Z'),
    });
    // Colons replaced with dashes for S3-safe keys.
    expect(key).toBe('backups/pg/sonic-bloom-pg-2026-05-16T10-30-45.123Z.dump');
  });

  test('respects custom prefix', () => {
    const key = buildObjectKey({
      prefix: 'daily/pg/',
      now: new Date('2026-05-16T00:00:00.000Z'),
    });
    expect(key).toBe('daily/pg/sonic-bloom-pg-2026-05-16T00-00-00.000Z.dump');
  });
});

describe('pruneOldBackups', () => {
  function fakeClient(objects, deletions) {
    return {
      send: vi.fn(async (cmd) => {
        const name = cmd.constructor.name;
        if (name === 'ListObjectsV2Command') {
          return { Contents: objects };
        }
        if (name === 'DeleteObjectCommand') {
          deletions.push(cmd.input.Key);
          return {};
        }
        throw new Error(`unexpected command ${name}`);
      }),
    };
  }

  test('deletes objects older than the cutoff, keeps newer', async () => {
    const now = new Date('2026-05-16T00:00:00Z');
    const objects = [
      {
        Key: 'backups/pg/old.dump',
        LastModified: new Date('2026-03-01T00:00:00Z'),
      },
      {
        Key: 'backups/pg/recent.dump',
        LastModified: new Date('2026-05-10T00:00:00Z'),
      },
      {
        Key: 'backups/pg/today.dump',
        LastModified: new Date('2026-05-16T00:00:00Z'),
      },
    ];
    const deletions = [];
    const client = fakeClient(objects, deletions);

    const result = await pruneOldBackups({
      client,
      bucket: 'sonic-bloom-media',
      prefix: 'backups/pg/',
      olderThanMs: 30 * 24 * 60 * 60 * 1000, // 30 days
      now,
    });

    expect(result.listed).toBe(3);
    expect(result.deleted).toBe(1);
    expect(deletions).toEqual(['backups/pg/old.dump']);
  });

  test('no-op when nothing is past the cutoff', async () => {
    const now = new Date('2026-05-16T00:00:00Z');
    const objects = [
      {
        Key: 'backups/pg/yesterday.dump',
        LastModified: new Date('2026-05-15T00:00:00Z'),
      },
    ];
    const deletions = [];
    const client = fakeClient(objects, deletions);

    const result = await pruneOldBackups({
      client,
      bucket: 'sonic-bloom-media',
      prefix: 'backups/pg/',
      olderThanMs: 30 * 24 * 60 * 60 * 1000,
      now,
    });

    expect(result.deleted).toBe(0);
    expect(deletions).toEqual([]);
  });

  test('skips objects without LastModified', async () => {
    const now = new Date('2026-05-16T00:00:00Z');
    const objects = [
      // No LastModified — treat as "infinitely new" so we never delete.
      { Key: 'backups/pg/unknown.dump' },
    ];
    const deletions = [];
    const client = fakeClient(objects, deletions);

    const result = await pruneOldBackups({
      client,
      bucket: 'sonic-bloom-media',
      prefix: 'backups/pg/',
      olderThanMs: 30 * 24 * 60 * 60 * 1000,
      now,
    });

    expect(result.deleted).toBe(0);
  });
});
