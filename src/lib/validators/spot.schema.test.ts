import { describe, it, expect } from 'vitest';
import { spotFormSchema } from './spot.schema';

describe('spotFormSchema', () => {
  const valid = {
    title: 'Spring Sale 30s',
    durationSec: 30,
    approvalStatus: 'pending' as const,
  };

  it('accepts valid spot', () => {
    const result = spotFormSchema.parse(valid);
    expect(result.title).toBe('Spring Sale 30s');
    expect(result.durationSec).toBe(30);
  });

  it('requires title', () => {
    expect(() => spotFormSchema.parse({ ...valid, title: '' })).toThrow();
  });

  it('rejects title longer than 200 chars', () => {
    expect(() => spotFormSchema.parse({ ...valid, title: 'x'.repeat(201) })).toThrow();
  });

  it('rejects duration below 5 seconds', () => {
    expect(() => spotFormSchema.parse({ ...valid, durationSec: 4 })).toThrow();
  });

  it('rejects duration above 120 seconds', () => {
    expect(() => spotFormSchema.parse({ ...valid, durationSec: 121 })).toThrow();
  });

  it('coerces durationSec from string', () => {
    const result = spotFormSchema.parse({ ...valid, durationSec: '60' });
    expect(result.durationSec).toBe(60);
  });

  it('accepts all approval statuses', () => {
    for (const s of ['pending', 'approved', 'rejected'] as const) {
      const result = spotFormSchema.parse({ ...valid, approvalStatus: s });
      expect(result.approvalStatus).toBe(s);
    }
  });

  it('rejects invalid approval status', () => {
    expect(() => spotFormSchema.parse({ ...valid, approvalStatus: 'cancelled' })).toThrow();
  });

  it('accepts optional fields', () => {
    const result = spotFormSchema.parse({
      ...valid,
      versionLabel: 'v2',
      scriptText: 'Buy now at Acme!',
      startDateOverride: '2026-04-10',
      endDateOverride: '2026-04-20',
    });
    expect(result.versionLabel).toBe('v2');
    expect(result.scriptText).toBe('Buy now at Acme!');
  });

  it('rejects versionLabel longer than 50 chars', () => {
    expect(() => spotFormSchema.parse({ ...valid, versionLabel: 'x'.repeat(51) })).toThrow();
  });

  it('rejects scriptText longer than 5000 chars', () => {
    expect(() => spotFormSchema.parse({ ...valid, scriptText: 'x'.repeat(5001) })).toThrow();
  });
});
