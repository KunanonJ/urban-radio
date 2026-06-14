/**
 * S3-compatible storage adapter for Cloudflare R2 — Wave RM-γ.
 *
 * R2 exposes an S3-compatible API at
 *   `https://<account-id>.r2.cloudflarestorage.com`
 * so we can talk to it from Railway/Node via `@aws-sdk/client-s3` exactly the
 * way we'd talk to AWS S3. This file implements the `StorageAdapter`
 * contract `src/server/storage.ts` defined in β3.
 *
 * Environment contract:
 *   STORAGE_ENDPOINT_URL — required, e.g. https://<acct>.r2.cloudflarestorage.com
 *   STORAGE_BUCKET       — required, e.g. sonic-bloom-media
 *   STORAGE_ACCESS_KEY_ID — required
 *   STORAGE_SECRET_ACCESS_KEY — required
 *   STORAGE_REGION       — optional, defaults to 'auto' (R2 ignores region)
 *   STORAGE_FORCE_PATH_STYLE — optional, '1' to force path-style addressing
 *                              (R2 wants this; AWS doesn't)
 *
 * Tests live alongside as `storage-s3.test.ts` and inject a stub `S3Client`
 * so we never reach the network. The contract surface mirrors what the
 * production R2 endpoint supports — `GetObject`, `PutObject`, `DeleteObject`,
 * presigned `GetObject` — nothing fancier.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-γ.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { StorageAdapter, StorageObject } from './storage';

export interface S3StorageEnv {
  STORAGE_ENDPOINT_URL?: string;
  STORAGE_BUCKET?: string;
  STORAGE_ACCESS_KEY_ID?: string;
  STORAGE_SECRET_ACCESS_KEY?: string;
  STORAGE_REGION?: string;
  STORAGE_FORCE_PATH_STYLE?: string;
}

export interface S3StorageConfig {
  bucket: string;
  /** Injected client — tests pass a stub; production builds from env. */
  client: S3Client;
  /**
   * Override the URL signer. Defaults to the AWS SDK's `getSignedUrl`. Tests
   * inject a stub because the AWS SDK presigner reaches into private client
   * config (`endpointProvider`) that our structural mocks don't carry.
   */
  signer?: (
    client: S3Client,
    command: GetObjectCommand,
    opts: { expiresIn: number },
  ) => Promise<string>;
}

/**
 * Build an `S3Client` from the documented environment contract. Returns
 * `null` when the required vars are missing so `getStorage()` can fall
 * back to the unconfigured stub without throwing during module load.
 */
export function buildS3ConfigFromEnv(
  env: S3StorageEnv = process.env as S3StorageEnv,
): S3StorageConfig | null {
  const endpoint = env.STORAGE_ENDPOINT_URL?.trim();
  const bucket = env.STORAGE_BUCKET?.trim();
  const accessKeyId = env.STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.STORAGE_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const clientConfig: S3ClientConfig = {
    endpoint,
    region: env.STORAGE_REGION?.trim() || 'auto',
    credentials: { accessKeyId, secretAccessKey },
    // R2 wants path-style (<endpoint>/<bucket>/<key>) addressing. The AWS
    // default is virtual-host style which R2 doesn't fully support.
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE !== '0',
  };

  return { bucket, client: new S3Client(clientConfig) };
}

/**
 * Cloudflare R2-backed `StorageAdapter`. Implementation is intentionally
 * straight: one SDK command per method, no caching, no retry beyond the
 * SDK's defaults.
 */
export class S3Storage implements StorageAdapter {
  constructor(private readonly cfg: S3StorageConfig) {}

  async get(key: string): Promise<StorageObject | null> {
    try {
      const out = await this.cfg.client.send(
        new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
      const body = out.Body;
      if (!body) return null;
      const bytes = await streamToBytes(body);
      return {
        body: bytes,
        contentType: out.ContentType ?? 'application/octet-stream',
        size: bytes.byteLength,
      };
    } catch (err: unknown) {
      // S3 SDK throws `NoSuchKey` (sometimes `NotFound`) with a `name` field.
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  async put(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.cfg.client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    try {
      await this.cfg.client.send(
        new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      );
    } catch (err: unknown) {
      // Be permissive: deleting a missing key is a no-op for our callers
      // (the route handlers use this for compensating rollback).
      if (isNotFoundError(err)) return;
      throw err;
    }
  }

  async presignGet(key: string, ttlSec: number): Promise<string> {
    // Pentest M-09: cap presigned URL TTL. Long-lived signed URLs are a
    // leakage risk — they bypass the auth layer entirely and survive any
    // logout. AWS S3 hard-limits presigned URLs to 7 days; we tighten to
    // 1 hour for typical use, and reject inputs that would exceed it.
    const clampedTtl = Math.min(
      Math.max(1, Math.floor(ttlSec)),
      MAX_PRESIGN_TTL_SEC,
    );
    const sign = this.cfg.signer ?? getSignedUrl;
    return sign(
      this.cfg.client,
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      { expiresIn: clampedTtl },
    );
  }
}

/**
 * Maximum TTL accepted by `S3Storage.presignGet`. Callers requesting a
 * larger value are silently clamped down. 1 hour is the standard
 * tradeoff: long enough for a browser to retry an audio stream over a
 * flaky connection, short enough that a leaked URL is mostly worthless.
 */
export const MAX_PRESIGN_TTL_SEC = 60 * 60;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  const code = (err as { Code?: string; $metadata?: { httpStatusCode?: number } })
    .Code;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
    ?.httpStatusCode;
  return (
    name === 'NoSuchKey' ||
    name === 'NotFound' ||
    code === 'NoSuchKey' ||
    code === 'NotFound' ||
    status === 404
  );
}

/**
 * Drain whatever the S3 SDK returned in `Body` into a `Uint8Array`. The SDK
 * gives us a `Readable` (Node) or web `ReadableStream` (web/edge runtimes)
 * depending on environment; both have `.transformToByteArray()` when run
 * under recent SDK versions but we don't rely on that for portability.
 */
async function streamToBytes(
  body: unknown,
): Promise<Uint8Array> {
  // Modern AWS SDK exposes a helper on the body.
  const withHelper = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (typeof withHelper.transformToByteArray === 'function') {
    return withHelper.transformToByteArray();
  }
  // Node `Readable`.
  const nodeStream = body as {
    on?: (event: string, cb: (...args: unknown[]) => void) => unknown;
  };
  if (typeof nodeStream.on === 'function') {
    return new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Buffer[] = [];
      nodeStream.on?.('data', (chunk: unknown) =>
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)),
      );
      nodeStream.on?.('end', () =>
        resolve(new Uint8Array(Buffer.concat(chunks))),
      );
      nodeStream.on?.('error', (err: unknown) => reject(err));
    });
  }
  // Web `ReadableStream` (worker / edge).
  const webStream = body as ReadableStream<Uint8Array>;
  if (
    typeof (webStream as { getReader?: () => unknown }).getReader === 'function'
  ) {
    const reader = webStream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
  throw new Error('Unsupported S3 Body type — cannot convert to Uint8Array');
}
