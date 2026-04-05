import { describe, it, expect } from 'vitest';
import { advertiserFormSchema } from './advertiser.schema';

describe('advertiserFormSchema', () => {
  const valid = {
    name: 'Acme Corp',
    contactName: 'Jane Doe',
    contactEmail: 'jane@acme.com',
    phone: '+1-555-0100',
    industry: 'Retail',
    status: 'active' as const,
  };

  it('accepts valid advertiser', () => {
    expect(advertiserFormSchema.parse(valid)).toEqual(valid);
  });

  it('requires name', () => {
    expect(() => advertiserFormSchema.parse({ ...valid, name: '' })).toThrow();
  });

  it('rejects name longer than 200 chars', () => {
    expect(() => advertiserFormSchema.parse({ ...valid, name: 'x'.repeat(201) })).toThrow();
  });

  it('accepts empty contactEmail (empty string)', () => {
    const result = advertiserFormSchema.parse({ ...valid, contactEmail: '' });
    expect(result.contactEmail).toBe('');
  });

  it('rejects invalid contactEmail', () => {
    expect(() => advertiserFormSchema.parse({ ...valid, contactEmail: 'not-an-email' })).toThrow();
  });

  it('requires status to be active or inactive', () => {
    expect(() => advertiserFormSchema.parse({ ...valid, status: 'deleted' })).toThrow();
  });

  it('allows optional fields to be omitted', () => {
    const minimal = { name: 'Minimal Inc', status: 'inactive' as const };
    const result = advertiserFormSchema.parse(minimal);
    expect(result.name).toBe('Minimal Inc');
    expect(result.status).toBe('inactive');
  });
});
