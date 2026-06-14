import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

/** Ensures migration seed hash matches PBKDF2-SHA256 (same as Workers `password.ts`). */
describe('auth demo password hash', () => {
  it('verifies demo user password', () => {
    const stored =
      'pbkdf2:100000:0123456789abcdef0123456789abcdef:f8de82344dd7c0631fa40d52a0348ece4e9b5ee5cb326c4d4a30af3172c7a8ac';
    const [, iter, saltHex, hashHex] = stored.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const derived = crypto.pbkdf2Sync('demo', salt, parseInt(iter, 10), 32, 'sha256');
    expect(derived.equals(expected)).toBe(true);
  });
});
