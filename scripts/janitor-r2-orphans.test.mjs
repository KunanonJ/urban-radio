/**
 * Unit tests for the pure helpers in `janitor-r2-orphans.mjs`.
 *
 * The janitor deletes confirmed-orphan objects from the S3-compatible bucket.
 * Because a wrong delete is irreversible (permanent audio loss), the safety
 * predicate `isOrphan` is the load-bearing unit under test, plus the
 * orchestration that turns its verdicts into DeleteObject calls.
 *
 * We never touch a real bucket or Postgres here — `sweepOrphans` takes an
 * injected fake S3 client and an injected referenced-key Set, mirroring the
 * fakeClient pattern in `backup-pg-to-s3.test.mjs`.
 */

import { describe, expect, test, vi } from 'vitest';

import { isOrphan, sweepOrphans } from './janitor-r2-orphans.mjs';

const HOUR_MS = 60 * 60 * 1000;
const GRACE_MS = 168 * HOUR_MS; // 7 days

describe('isOrphan', () => {
  const now = new Date('2026-06-14T00:00:00Z');

  test('given a referenced key > returns false (never delete live media)', () => {
    const key = 'uploads/abc/song.mp3';
    const obj = {
      Key: key,
      // Old enough to be past the grace window, but it IS referenced.
      LastModified: new Date('2026-01-01T00:00:00Z'),
    };
    const referenced = new Set([key]);

    expect(isOrphan(obj, referenced, now, GRACE_MS)).toBe(false);
  });

  test('given unreferenced + older than grace > returns true', () => {
    const obj = {
      Key: 'uploads/dead/orphan.mp3',
      LastModified: new Date('2026-06-01T00:00:00Z'), // 13 days old
    };
    const referenced = new Set(['uploads/abc/song.mp3']);

    expect(isOrphan(obj, referenced, now, GRACE_MS)).toBe(true);
  });

  test('given unreferenced but within the grace window > returns false', () => {
    const obj = {
      Key: 'uploads/fresh/inflight.mp3',
      // 1 hour old — DB row may not have committed yet.
      LastModified: new Date('2026-06-13T23:00:00Z'),
    };
    const referenced = new Set();

    expect(isOrphan(obj, referenced, now, GRACE_MS)).toBe(false);
  });

  test('given missing LastModified > returns false (never delete what we cannot date)', () => {
    const obj = { Key: 'uploads/undated/mystery.mp3' };
    const referenced = new Set();

    expect(isOrphan(obj, referenced, now, GRACE_MS)).toBe(false);
  });
});

describe('sweepOrphans', () => {
  function fakeClient(pages, deletions) {
    let call = 0;
    return {
      send: vi.fn(async (cmd) => {
        const name = cmd.constructor.name;
        if (name === 'ListObjectsV2Command') {
          const page = pages[call] ?? { Contents: [] };
          call += 1;
          return page;
        }
        if (name === 'DeleteObjectCommand') {
          deletions.push(cmd.input.Key);
          return {};
        }
        throw new Error(`unexpected command ${name}`);
      }),
    };
  }

  const now = new Date('2026-06-14T00:00:00Z');
  const OLD = new Date('2026-06-01T00:00:00Z'); // 13 days → past grace
  const FRESH = new Date('2026-06-13T23:00:00Z'); // 1 hour → within grace

  /** A single un-paginated listing covering every branch of isOrphan. */
  function mixedListing() {
    return [
      {
        Contents: [
          // referenced + old → keep
          { Key: 'uploads/live/a.mp3', LastModified: OLD },
          // unreferenced + old → DELETE
          { Key: 'uploads/dead/b.mp3', LastModified: OLD },
          // unreferenced + fresh → keep (grace)
          { Key: 'uploads/fresh/c.mp3', LastModified: FRESH },
          // unreferenced + undated → keep (cannot date)
          { Key: 'uploads/undated/d.mp3' },
          // referenced voice-track key + old → keep
          {
            Key: 'stations/s1/voice-tracks/vt1.mp3',
            LastModified: OLD,
          },
          // unreferenced voice-track key + old → DELETE
          {
            Key: 'stations/s1/voice-tracks/orphan.mp3',
            LastModified: OLD,
          },
        ],
      },
    ];
  }

  const referencedKeys = new Set([
    'uploads/live/a.mp3',
    'stations/s1/voice-tracks/vt1.mp3',
  ]);

  test('apply mode > deletes exactly the confirmed orphans, nothing else', async () => {
    const deletions = [];
    const client = fakeClient(mixedListing(), deletions);

    const result = await sweepOrphans({
      client,
      bucket: 'sonic-bloom-media',
      referencedKeys,
      graceMs: GRACE_MS,
      now,
      apply: true,
    });

    // Only the two unreferenced-and-old keys are deleted.
    expect(deletions.sort()).toEqual([
      'stations/s1/voice-tracks/orphan.mp3',
      'uploads/dead/b.mp3',
    ]);
    expect(result.listed).toBe(6);
    expect(result.referenced).toBe(2);
    expect(result.orphan).toBe(2);
    expect(result.deleted).toBe(2);
    // 2 unreferenced-but-protected objects (fresh + undated) skipped in grace.
    expect(result.skippedInGrace).toBe(2);
  });

  test('dry-run mode > reports orphans but issues zero deletes', async () => {
    const deletions = [];
    const client = fakeClient(mixedListing(), deletions);

    const result = await sweepOrphans({
      client,
      bucket: 'sonic-bloom-media',
      referencedKeys,
      graceMs: GRACE_MS,
      now,
      apply: false,
    });

    expect(deletions).toEqual([]);
    expect(result.orphan).toBe(2);
    expect(result.deleted).toBe(0);
  });

  test('paginates with ContinuationToken until the listing is exhausted', async () => {
    const pages = [
      {
        Contents: [{ Key: 'uploads/dead/p1.mp3', LastModified: OLD }],
        IsTruncated: true,
        NextContinuationToken: 'tok-1',
      },
      {
        Contents: [{ Key: 'uploads/dead/p2.mp3', LastModified: OLD }],
        IsTruncated: false,
      },
    ];
    const deletions = [];
    const client = fakeClient(pages, deletions);

    const result = await sweepOrphans({
      client,
      bucket: 'sonic-bloom-media',
      referencedKeys: new Set(),
      graceMs: GRACE_MS,
      now,
      apply: true,
    });

    expect(result.listed).toBe(2);
    expect(deletions.sort()).toEqual([
      'uploads/dead/p1.mp3',
      'uploads/dead/p2.mp3',
    ]);
  });

  test('a single delete failure is logged and does not abort the sweep', async () => {
    const pages = [
      {
        Contents: [
          { Key: 'uploads/dead/boom.mp3', LastModified: OLD },
          { Key: 'uploads/dead/ok.mp3', LastModified: OLD },
        ],
      },
    ];
    const deletions = [];
    const client = {
      send: vi.fn(async (cmd) => {
        const name = cmd.constructor.name;
        if (name === 'ListObjectsV2Command') return pages[0];
        if (name === 'DeleteObjectCommand') {
          if (cmd.input.Key === 'uploads/dead/boom.mp3') {
            throw new Error('R2 503');
          }
          deletions.push(cmd.input.Key);
          return {};
        }
        throw new Error(`unexpected command ${name}`);
      }),
    };
    const warns = [];
    const logger = { log: () => {}, warn: (m) => warns.push(m) };

    const result = await sweepOrphans({
      client,
      bucket: 'sonic-bloom-media',
      referencedKeys: new Set(),
      graceMs: GRACE_MS,
      now,
      apply: true,
      logger,
    });

    // The healthy object still gets deleted; the failure is counted, not thrown.
    expect(deletions).toEqual(['uploads/dead/ok.mp3']);
    expect(result.orphan).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(1);
    expect(warns.some((m) => String(m).includes('boom.mp3'))).toBe(true);
  });
});
