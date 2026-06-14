// @vitest-environment node

/**
 * Storage adapter contract tests.
 *
 * Wave γ will replace `getStorage()` with a real S3 / R2-over-HTTPS client,
 * but the unconfigured stub MUST throw a clear error on every operation
 * until that lands — silent storage drops are far worse than loud failures.
 *
 * The in-memory adapter is the contract tests pin: every Wave γ implementation
 * has to satisfy these behaviours (get-after-put, delete-then-get-null,
 * etc.) or tests downstream will break.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  __resetStorageCacheForTests,
  createInMemoryStorage,
  getStorage,
  isStorageNotConfigured,
} from './storage';

describe('getStorage (unconfigured stub)', () => {
  test('get throws StorageNotConfiguredError with actionable message', async () => {
    const s = getStorage();
    await expect(s.get('x')).rejects.toThrow(/Storage not configured/);
  });

  test('put throws StorageNotConfiguredError', async () => {
    const s = getStorage();
    await expect(
      s.put('x', new Uint8Array([1]), 'application/octet-stream'),
    ).rejects.toThrow(/Storage not configured/);
  });

  test('delete throws StorageNotConfiguredError', async () => {
    const s = getStorage();
    await expect(s.delete('x')).rejects.toThrow(/Storage not configured/);
  });

  test('presignGet throws StorageNotConfiguredError', async () => {
    const s = getStorage();
    await expect(s.presignGet('x', 60)).rejects.toThrow(
      /Storage not configured/,
    );
  });

  test('isStorageNotConfigured narrows the thrown error', async () => {
    const s = getStorage();
    try {
      await s.get('x');
      expect.fail('expected throw');
    } catch (err) {
      expect(isStorageNotConfigured(err)).toBe(true);
    }
  });

  test('arbitrary errors are NOT classified as not-configured', () => {
    expect(isStorageNotConfigured(new Error('something else'))).toBe(false);
    expect(isStorageNotConfigured('not an error at all')).toBe(false);
    expect(isStorageNotConfigured(null)).toBe(false);
  });
});

describe('getStorage error logging (Pentest L-02)', () => {
  beforeEach(() => {
    __resetStorageCacheForTests();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unmock('./storage-s3');
    __resetStorageCacheForTests();
  });

  test('does not pass the full error object to console.warn when the S3 adapter fails to load', async () => {
    // Force the S3 adapter build to throw with an error whose message embeds a
    // credential-shaped field name. The catch in getStorage() must NOT forward
    // the raw error object (which could carry such fields) to console.warn.
    const leakyMessage =
      'connect ECONNREFUSED STORAGE_SECRET_ACCESS_KEY=super-secret-value';
    vi.doMock('./storage-s3', () => ({
      buildS3ConfigFromEnv: () => {
        throw new Error(leakyMessage);
      },
      S3Storage: class {},
    }));

    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const mod = await import('./storage');
    mod.__resetStorageCacheForTests();
    const adapter = mod.getStorage();

    // Still falls back to the unconfigured stub.
    await expect(adapter.get('x')).rejects.toThrow(/Storage not configured/);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const args = warnSpy.mock.calls[0];

    // The raw Error object must never be one of the logged arguments.
    expect(args).not.toContain(args.find((a) => a instanceof Error));
    for (const arg of args) {
      expect(arg).not.toBeInstanceOf(Error);
    }

    // And the secret value embedded in the error message must not leak through
    // any stringified argument.
    const joined = args.map((a) => String(a)).join(' ');
    expect(joined).not.toContain('super-secret-value');
    expect(joined).not.toContain('STORAGE_SECRET_ACCESS_KEY');
  });
});

describe('createInMemoryStorage', () => {
  test('put → get round-trips bytes and content-type', async () => {
    const s = createInMemoryStorage();
    const body = new Uint8Array([1, 2, 3, 4]);
    await s.put('key-a', body, 'audio/mpeg');

    const got = await s.get('key-a');
    expect(got).not.toBeNull();
    expect(got!.body).toEqual(body);
    expect(got!.contentType).toBe('audio/mpeg');
    expect(got!.size).toBe(4);
  });

  test('get of an unknown key returns null', async () => {
    const s = createInMemoryStorage();
    expect(await s.get('missing')).toBeNull();
  });

  test('delete removes the object', async () => {
    const s = createInMemoryStorage();
    await s.put('to-delete', new Uint8Array([9]), 'text/plain');
    expect(await s.get('to-delete')).not.toBeNull();
    await s.delete('to-delete');
    expect(await s.get('to-delete')).toBeNull();
    expect(s.deletes).toEqual(['to-delete']);
  });

  test('delete of a missing key is a no-op (no throw)', async () => {
    const s = createInMemoryStorage();
    await expect(s.delete('never-existed')).resolves.toBeUndefined();
  });

  test('seed pre-populates objects', async () => {
    const s = createInMemoryStorage({
      seed: {
        'k1': { body: new Uint8Array([7, 8]), contentType: 'audio/wav' },
      },
    });
    const got = await s.get('k1');
    expect(got!.contentType).toBe('audio/wav');
    expect(got!.size).toBe(2);
  });

  test('failPutWith makes put reject with the configured message', async () => {
    const s = createInMemoryStorage({ failPutWith: 'simulated R2 down' });
    await expect(
      s.put('k', new Uint8Array([1]), 'audio/mpeg'),
    ).rejects.toThrow('simulated R2 down');
  });

  test('failGetWith makes get reject with the configured message', async () => {
    const s = createInMemoryStorage({ failGetWith: 'simulated R2 read fail' });
    await expect(s.get('k')).rejects.toThrow('simulated R2 read fail');
  });

  test('puts array records every put call in order', async () => {
    const s = createInMemoryStorage();
    await s.put('a', new Uint8Array([1]), 'audio/mpeg');
    await s.put('b', new Uint8Array([2, 3]), 'audio/wav');
    expect(s.puts).toEqual([
      { key: 'a', contentType: 'audio/mpeg', size: 1 },
      { key: 'b', contentType: 'audio/wav', size: 2 },
    ]);
  });

  test('presignGet returns a deterministic test URL', async () => {
    const s = createInMemoryStorage();
    const url = await s.presignGet('uploads/abc/x.mp3', 60);
    expect(url).toBe('memory://uploads/abc/x.mp3?ttl=60');
  });
});
