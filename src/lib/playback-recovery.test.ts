import { describe, expect, it } from 'vitest';
import { BASE_RETRY_MS, MAX_RECOVERY_ATTEMPTS, recoveryBackoffMs } from '@/lib/playback-recovery';

describe('playback-recovery', () => {
  it('recoveryBackoffMs doubles up to cap', () => {
    expect(recoveryBackoffMs(0)).toBe(BASE_RETRY_MS);
    expect(recoveryBackoffMs(1)).toBe(BASE_RETRY_MS * 2);
    expect(recoveryBackoffMs(2)).toBe(BASE_RETRY_MS * 4);
    expect(recoveryBackoffMs(3)).toBe(BASE_RETRY_MS * 8);
    expect(recoveryBackoffMs(4)).toBe(BASE_RETRY_MS * 16);
    expect(recoveryBackoffMs(5)).toBe(BASE_RETRY_MS * 16);
    expect(recoveryBackoffMs(99)).toBe(BASE_RETRY_MS * 16);
  });

  it('MAX_RECOVERY_ATTEMPTS is positive', () => {
    expect(MAX_RECOVERY_ATTEMPTS).toBeGreaterThan(0);
  });
});
