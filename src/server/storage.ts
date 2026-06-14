/**
 * Storage adapter — minimal R2-shaped contract for Next-side route handlers.
 *
 * The Cloudflare deployment uses `env.MEDIA_BUCKET` (an R2Bucket binding) for
 * audio object storage. On the Railway side we don't have R2 bindings; the
 * production implementation will be an S3 / R2-over-HTTPS wrapper that lands
 * in Wave RM-γ.
 *
 * This file defines:
 *  - `StorageAdapter` — the interface routes depend on.
 *  - `getStorage()` — returns the configured adapter, or a stub that throws
 *    a clear "storage not configured" error if no env is wired up.
 *  - Helpers tests use to inject in-memory stubs.
 *
 * Routes are written against the interface and accept a `storage` dep so
 * tests can substitute an in-memory adapter without touching real S3/R2.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β3.
 */

export interface StorageObject {
  /** Raw object bytes. Routes that stream audio return `body` directly to the client. */
  body: Uint8Array;
  /** MIME type the object was stored with. */
  contentType: string;
  /** Size in bytes (matches `body.byteLength` for in-memory adapters). */
  size: number;
}

export interface StorageAdapter {
  /**
   * Fetch a single object. Returns `null` if the key does not exist.
   * Routes that map to a 404 should compare against null rather than catching.
   */
  get(key: string): Promise<StorageObject | null>;

  /**
   * Persist bytes under a key. Implementations should fail fast if the
   * underlying store rejects the write — routes treat a thrown error as a
   * 500 storage failure.
   */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;

  /**
   * Best-effort delete. Implementations should NOT throw for a missing key;
   * routes call this for compensating rollback after a failed DB write and
   * a missing key there is harmless.
   */
  delete(key: string): Promise<void>;

  /**
   * Mint a time-bounded URL the client can GET directly. Optional for
   * Wave β3 — the only handler that needs this in this batch is the
   * tracks/:id/stream route, and that one currently streams bytes through
   * the Next handler. Provided here so Wave γ's S3 implementation has a
   * concrete signature to fill in.
   */
  presignGet(key: string, ttlSec: number): Promise<string>;
}

// ---------------------------------------------------------------------------
// Stub: throws a clear "storage not configured" error if invoked.
// ---------------------------------------------------------------------------

class StorageNotConfiguredError extends Error {
  constructor(op: string) {
    super(
      `Storage not configured: cannot ${op}. Set STORAGE_* env vars or pass a StorageAdapter via deps. See docs/RAILWAY-KICKOFF.md Wave RM-γ.`,
    );
    this.name = 'StorageNotConfiguredError';
  }
}

class UnconfiguredStorage implements StorageAdapter {
  async get(_key: string): Promise<StorageObject | null> {
    throw new StorageNotConfiguredError('get');
  }
  async put(_key: string, _body: Uint8Array, _contentType: string): Promise<void> {
    throw new StorageNotConfiguredError('put');
  }
  async delete(_key: string): Promise<void> {
    throw new StorageNotConfiguredError('delete');
  }
  async presignGet(_key: string, _ttlSec: number): Promise<string> {
    throw new StorageNotConfiguredError('presignGet');
  }
}

export function isStorageNotConfigured(err: unknown): boolean {
  return err instanceof StorageNotConfiguredError;
}

/**
 * Returns the configured storage adapter.
 *
 * Wave γ: when `STORAGE_*` env vars are present, returns an S3-compatible
 * adapter pointed at Cloudflare R2 (`src/server/storage-s3.ts`). Otherwise
 * returns the unconfigured stub, which throws a clear error on every call.
 *
 * The S3 module is loaded via dynamic import so unconfigured environments
 * (local dev without R2, jsdom tests) don't pay the AWS SDK's startup cost.
 *
 * Cached after first successful build so we reuse the underlying
 * `S3Client` (HTTP keep-alive, connection pool).
 */
let cachedAdapter: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cachedAdapter) return cachedAdapter;

  // Lazy-load to keep the SDK out of the bundle for envs that don't need it.
  // The import cost is paid once per process.
  try {
    // require() so we don't promote `getStorage` to async — routes call it sync.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./storage-s3') as typeof import('./storage-s3');
    const cfg = mod.buildS3ConfigFromEnv();
    if (cfg) {
      cachedAdapter = new mod.S3Storage(cfg);
      return cachedAdapter;
    }
  } catch (err) {
    // Loading or building the S3 adapter failed — fall through to stub.
    // Surface enough for ops to grep for, but don't crash the route.
    //
    // Pentest L-02: log ONLY the error's class name, never the full error
    // object. The raw error (or its message) can embed credential field names
    // or values pulled from the environment — logging it verbatim leaks that
    // into stdout. `err.name` is a safe, non-sensitive discriminator.
    const errName = err instanceof Error ? err.name : typeof err;
    // eslint-disable-next-line no-console
    console.warn(
      `[storage] S3 adapter unavailable (${errName}) — falling back to stub`,
    );
  }

  cachedAdapter = new UnconfiguredStorage();
  return cachedAdapter;
}

/**
 * Test-only escape hatch. Clears the cached adapter so the next `getStorage()`
 * call rebuilds it (e.g. after mutating `process.env.STORAGE_*` in tests).
 */
export function __resetStorageCacheForTests(): void {
  cachedAdapter = null;
}

// ---------------------------------------------------------------------------
// Test helper: an in-memory adapter routes can be wired to in tests.
// Exported so any wave/test suite can drop one in without re-implementing the
// shape. Kept tiny on purpose — production storage belongs in Wave γ.
// ---------------------------------------------------------------------------

export interface InMemoryStorageOptions {
  /** Pre-seed objects keyed by storage key. Useful for "object exists" tests. */
  seed?: Record<string, { body: Uint8Array; contentType: string }>;
  /**
   * If set, `put` will throw with this error message. Lets tests exercise
   * the "storage write failed" branch without monkey-patching.
   */
  failPutWith?: string;
  /**
   * If set, `get` will throw with this error message. Lets tests exercise
   * adapter-level failure handling.
   */
  failGetWith?: string;
}

export interface InMemoryStorage extends StorageAdapter {
  /** Backing map — tests can assert on `Object.keys(...).length` etc. */
  readonly objects: Map<string, StorageObject>;
  /** Ordered list of (key, contentType) pairs across all `put` calls. */
  readonly puts: ReadonlyArray<{ key: string; contentType: string; size: number }>;
  /** Ordered list of `delete` keys. */
  readonly deletes: ReadonlyArray<string>;
}

export function createInMemoryStorage(
  opts: InMemoryStorageOptions = {},
): InMemoryStorage {
  const objects = new Map<string, StorageObject>();
  const puts: Array<{ key: string; contentType: string; size: number }> = [];
  const deletes: string[] = [];

  if (opts.seed) {
    for (const [key, val] of Object.entries(opts.seed)) {
      objects.set(key, {
        body: val.body,
        contentType: val.contentType,
        size: val.body.byteLength,
      });
    }
  }

  return {
    objects,
    puts,
    deletes,
    async get(key) {
      if (opts.failGetWith) throw new Error(opts.failGetWith);
      return objects.get(key) ?? null;
    },
    async put(key, body, contentType) {
      if (opts.failPutWith) throw new Error(opts.failPutWith);
      objects.set(key, { body, contentType, size: body.byteLength });
      puts.push({ key, contentType, size: body.byteLength });
    },
    async delete(key) {
      objects.delete(key);
      deletes.push(key);
    },
    async presignGet(key, ttlSec) {
      // Deterministic test URL; Wave γ will replace with real S3 signer.
      return `memory://${key}?ttl=${ttlSec}`;
    },
  };
}
