import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  backupTimestamp,
  buildBackupKey,
  resolveConfig,
  backup,
} from './backup-d1-to-r2.mjs';

let warnSpy;
let infoSpy;
let errorSpy;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  infoSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('backupTimestamp', () => {
  test('produces filename-safe ISO timestamp (no colons)', () => {
    const stamp = backupTimestamp(new Date('2026-05-14T21:30:45.123Z'));
    expect(stamp).toBe('2026-05-14T21-30-45.123Z');
    expect(stamp).not.toMatch(/:/);
  });

  test('matches the ISO-with-dashes shape', () => {
    const stamp = backupTimestamp(new Date('2026-01-02T03:04:05.006Z'));
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/);
  });
});

describe('buildBackupKey', () => {
  test('uses the default prefix and DB name', () => {
    const key = buildBackupKey({ now: new Date('2026-05-14T21:30:00.000Z') });
    expect(key).toBe('backups/sonic-bloom-db-2026-05-14T21-30-00.000Z.sql');
  });

  test('respects custom prefix and dbName', () => {
    const key = buildBackupKey({
      prefix: 'dumps/',
      dbName: 'alt-db',
      now: new Date('2026-05-14T21:30:00.000Z'),
    });
    expect(key).toBe('dumps/alt-db-2026-05-14T21-30-00.000Z.sql');
  });
});

describe('resolveConfig', () => {
  test('returns defaults with a warning when BACKUP_BUCKET is unset', () => {
    const cfg = resolveConfig({});
    expect(cfg.bucket).toBe('sonic-bloom-media');
    expect(cfg.dbName).toBe('sonic-bloom-db');
    expect(cfg.prefix).toBe('backups/');
    expect(cfg.warnings).toHaveLength(1);
    expect(cfg.warnings[0]).toMatch(/BACKUP_BUCKET/);
  });

  test('uses BACKUP_BUCKET when set, with no warning', () => {
    const cfg = resolveConfig({ BACKUP_BUCKET: 'prod-backups' });
    expect(cfg.bucket).toBe('prod-backups');
    expect(cfg.warnings).toHaveLength(0);
  });

  test('overrides db name and prefix from env', () => {
    const cfg = resolveConfig({
      BACKUP_BUCKET: 'b',
      BACKUP_DB_NAME: 'staging-db',
      BACKUP_PREFIX: 'staging/',
    });
    expect(cfg.dbName).toBe('staging-db');
    expect(cfg.prefix).toBe('staging/');
  });
});

describe('backup() entrypoint', () => {
  test('on success > calls wrangler d1 export then r2 object put, returns ok:true', async () => {
    const calls = [];
    const run = vi.fn((args) => {
      calls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    });
    const result = await backup({
      env: { BACKUP_BUCKET: 'prod-backups' },
      now: new Date('2026-05-14T21:30:00.000Z'),
      run,
      workdirFactory: () => '/tmp/test-backup',
      fileExists: () => true,
    });
    expect(result.ok).toBe(true);
    expect(result.key).toBe('backups/sonic-bloom-db-2026-05-14T21-30-00.000Z.sql');
    expect(result.bucket).toBe('prod-backups');
    expect(calls).toHaveLength(2);
    // First call: d1 export
    expect(calls[0][0]).toBe('d1');
    expect(calls[0][1]).toBe('export');
    expect(calls[0][2]).toBe('sonic-bloom-db');
    // Second call: r2 object put
    expect(calls[1][0]).toBe('r2');
    expect(calls[1][1]).toBe('object');
    expect(calls[1][2]).toBe('put');
    expect(calls[1][3]).toContain('prod-backups/');
  });

  test('on wrangler failure > returns ok:false without throwing', async () => {
    const run = vi.fn(() => {
      throw new Error('wrangler not found');
    });
    const result = await backup({
      env: { BACKUP_BUCKET: 'b' },
      run,
      workdirFactory: () => '/tmp/test-backup',
      fileExists: () => true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/wrangler not found/);
    expect(errorSpy).toHaveBeenCalled();
  });

  test('on missing dump file > returns ok:false', async () => {
    const run = vi.fn(() => ({ status: 0 }));
    const result = await backup({
      env: { BACKUP_BUCKET: 'b' },
      run,
      workdirFactory: () => '/tmp/test-backup',
      fileExists: () => false,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/dump file/i);
  });
});
