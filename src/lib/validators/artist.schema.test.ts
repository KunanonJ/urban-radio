import { describe, it, expect } from 'vitest';
import { artistFormSchema } from './artist.schema';

describe('artistFormSchema', () => {
  it('accepts valid artist data', () => {
    const result = artistFormSchema.safeParse({
      name: 'Drake',
      country: 'Canada',
      status: 'active',
    });
    expect(result.success).toBe(true);
  });

  it('accepts artist without optional country', () => {
    const result = artistFormSchema.safeParse({
      name: 'Beyonce',
      status: 'active',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = artistFormSchema.safeParse({
      name: '',
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 200 characters', () => {
    const result = artistFormSchema.safeParse({
      name: 'A'.repeat(201),
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = artistFormSchema.safeParse({
      name: 'Test Artist',
      status: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts archived status', () => {
    const result = artistFormSchema.safeParse({
      name: 'Old Artist',
      status: 'archived',
    });
    expect(result.success).toBe(true);
  });
});
