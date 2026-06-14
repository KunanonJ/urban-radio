// @vitest-environment node

/**
 * Tests for the S3-compatible `StorageAdapter` (Wave RM-γ).
 *
 * We inject a fake `S3Client` whose `send` method returns canned responses,
 * so no network I/O happens. The AWS SDK's `send(command)` signature is
 * stable enough for a structural mock.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { S3Storage, buildS3ConfigFromEnv } from './storage-s3';

interface FakeSentCommand {
  name: string;
  input: Record<string, unknown>;
}

function makeFakeClient(opts: {
  sendImpl?: (cmd: FakeSentCommand) => unknown;
}): {
  client: { send: (cmd: unknown) => Promise<unknown> };
  calls: FakeSentCommand[];
} {
  const calls: FakeSentCommand[] = [];
  const client = {
    send: vi.fn(async (cmd: unknown) => {
      const ctor = (cmd as { constructor?: { name?: string } }).constructor;
      const recorded: FakeSentCommand = {
        name: ctor?.name ?? 'Unknown',
        input: (cmd as { input: Record<string, unknown> }).input,
      };
      calls.push(recorded);
      if (opts.sendImpl) return opts.sendImpl(recorded);
      return {};
    }),
  };
  return { client, calls };
}

describe('buildS3ConfigFromEnv', () => {
  test('returns null when required vars are missing', () => {
    expect(buildS3ConfigFromEnv({})).toBeNull();
    expect(
      buildS3ConfigFromEnv({
        STORAGE_ENDPOINT_URL: 'https://example.r2.cloudflarestorage.com',
        STORAGE_BUCKET: 'b',
      }),
    ).toBeNull();
  });

  test('builds a config when all vars are set', () => {
    const cfg = buildS3ConfigFromEnv({
      STORAGE_ENDPOINT_URL: 'https://example.r2.cloudflarestorage.com',
      STORAGE_BUCKET: 'media',
      STORAGE_ACCESS_KEY_ID: 'AKIA-fake',
      STORAGE_SECRET_ACCESS_KEY: 'secret-fake',
    });
    expect(cfg).not.toBeNull();
    expect(cfg!.bucket).toBe('media');
  });
});

describe('S3Storage.get', () => {
  let storage: S3Storage;
  let calls: FakeSentCommand[];

  beforeEach(() => {
    const { client, calls: c } = makeFakeClient({
      sendImpl: (cmd) => {
        if (cmd.name === 'GetObjectCommand') {
          if (cmd.input.Key === 'missing') {
            const err = new Error('not found') as Error & { name: string };
            err.name = 'NoSuchKey';
            throw err;
          }
          return {
            Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
            ContentType: 'audio/mpeg',
          };
        }
        return {};
      },
    });
    calls = c;
    storage = new S3Storage({
      bucket: 'media',
      client: client as unknown as ConstructorParameters<typeof S3Storage>[0]['client'],
    });
  });

  test('returns null when the key does not exist', async () => {
    const obj = await storage.get('missing');
    expect(obj).toBeNull();
  });

  test('returns body + content-type + size for existing keys', async () => {
    const obj = await storage.get('found');
    expect(obj).not.toBeNull();
    expect(obj!.contentType).toBe('audio/mpeg');
    expect(obj!.size).toBe(3);
    expect(obj!.body).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls.at(-1)?.input).toMatchObject({ Bucket: 'media', Key: 'found' });
  });
});

describe('S3Storage.put', () => {
  test('sends PutObjectCommand with bucket + key + bytes', async () => {
    const { client, calls } = makeFakeClient({});
    const storage = new S3Storage({
      bucket: 'media',
      client: client as unknown as ConstructorParameters<typeof S3Storage>[0]['client'],
    });
    await storage.put('voice-tracks/abc.mp3', new Uint8Array([9, 8, 7, 6]), 'audio/mp3');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('PutObjectCommand');
    expect(calls[0].input).toMatchObject({
      Bucket: 'media',
      Key: 'voice-tracks/abc.mp3',
      ContentType: 'audio/mp3',
      ContentLength: 4,
    });
    expect(calls[0].input.Body).toEqual(new Uint8Array([9, 8, 7, 6]));
  });
});

describe('S3Storage.delete', () => {
  test('sends DeleteObjectCommand', async () => {
    const { client, calls } = makeFakeClient({});
    const storage = new S3Storage({
      bucket: 'media',
      client: client as unknown as ConstructorParameters<typeof S3Storage>[0]['client'],
    });
    await storage.delete('voice-tracks/abc.mp3');
    expect(calls[0].name).toBe('DeleteObjectCommand');
    expect(calls[0].input).toMatchObject({
      Bucket: 'media',
      Key: 'voice-tracks/abc.mp3',
    });
  });

  test('is no-op when the key is already gone (NoSuchKey is swallowed)', async () => {
    const { client } = makeFakeClient({
      sendImpl: () => {
        const err = new Error('gone') as Error & { name: string };
        err.name = 'NoSuchKey';
        throw err;
      },
    });
    const storage = new S3Storage({
      bucket: 'media',
      client: client as unknown as ConstructorParameters<typeof S3Storage>[0]['client'],
    });
    await expect(storage.delete('missing')).resolves.toBeUndefined();
  });

  test('re-throws unexpected errors (5xx, network)', async () => {
    const { client } = makeFakeClient({
      sendImpl: () => {
        throw new Error('500 service unavailable');
      },
    });
    const storage = new S3Storage({
      bucket: 'media',
      client: client as unknown as ConstructorParameters<typeof S3Storage>[0]['client'],
    });
    await expect(storage.delete('any')).rejects.toThrow(/service unavailable/);
  });
});

describe('S3Storage.presignGet', () => {
  test('delegates to the injected signer with command + expiresIn', async () => {
    const { client } = makeFakeClient({});
    // Type the signer with its three params so mock.calls[0] is a 3-tuple,
    // not the empty tuple inferred from a zero-arg arrow.
    const signer = vi.fn<
      (client: unknown, command: unknown, opts: unknown) => Promise<string>
    >(async () => 'https://signed.example/abc?sig=xyz');
    const storage = new S3Storage({
      bucket: 'media',
      client: client as unknown as ConstructorParameters<typeof S3Storage>[0]['client'],
      signer: signer as unknown as ConstructorParameters<typeof S3Storage>[0]['signer'],
    });
    const url = await storage.presignGet('voice-tracks/abc.mp3', 300);
    expect(url).toBe('https://signed.example/abc?sig=xyz');
    expect(signer).toHaveBeenCalledTimes(1);
    const [, command, opts] = signer.mock.calls[0];
    expect((command as { input: Record<string, unknown> }).input).toMatchObject({
      Bucket: 'media',
      Key: 'voice-tracks/abc.mp3',
    });
    expect(opts).toEqual({ expiresIn: 300 });
  });
});
