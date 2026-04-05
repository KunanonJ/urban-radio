import { describe, it, expect } from 'vitest';
import { campaignFormSchema } from './campaign.schema';

describe('campaignFormSchema', () => {
  const valid = {
    advertiserId: 'adv-001',
    campaignName: 'Spring Sale',
    startDate: '2026-04-01',
    endDate: '2026-04-30',
    contractedSpots: 100,
    priority: 'normal' as const,
    allowedDays: [1, 2, 3, 4, 5],
    status: 'draft' as const,
  };

  it('accepts valid campaign', () => {
    const result = campaignFormSchema.parse(valid);
    expect(result.campaignName).toBe('Spring Sale');
  });

  it('requires campaignName', () => {
    expect(() => campaignFormSchema.parse({ ...valid, campaignName: '' })).toThrow();
  });

  it('requires advertiserId', () => {
    expect(() => campaignFormSchema.parse({ ...valid, advertiserId: '' })).toThrow();
  });

  it('requires at least 1 contracted spot', () => {
    expect(() => campaignFormSchema.parse({ ...valid, contractedSpots: 0 })).toThrow();
  });

  it('coerces contractedSpots from string', () => {
    const result = campaignFormSchema.parse({ ...valid, contractedSpots: '50' });
    expect(result.contractedSpots).toBe(50);
  });

  it('rejects endDate before startDate', () => {
    expect(() =>
      campaignFormSchema.parse({ ...valid, startDate: '2026-05-01', endDate: '2026-04-01' }),
    ).toThrow('End date must be on or after start date');
  });

  it('accepts same start and end date', () => {
    const result = campaignFormSchema.parse({ ...valid, startDate: '2026-04-15', endDate: '2026-04-15' });
    expect(result.startDate).toBe('2026-04-15');
  });

  it('requires at least one allowed day', () => {
    expect(() => campaignFormSchema.parse({ ...valid, allowedDays: [] })).toThrow();
  });

  it('rejects invalid day numbers', () => {
    expect(() => campaignFormSchema.parse({ ...valid, allowedDays: [7] })).toThrow();
  });

  it('validates priority enum', () => {
    expect(() => campaignFormSchema.parse({ ...valid, priority: 'ultra' })).toThrow();
  });

  it('accepts all valid priorities', () => {
    for (const p of ['low', 'normal', 'high', 'guaranteed'] as const) {
      const result = campaignFormSchema.parse({ ...valid, priority: p });
      expect(result.priority).toBe(p);
    }
  });

  it('accepts all valid statuses', () => {
    for (const s of ['draft', 'active', 'paused', 'completed', 'expired'] as const) {
      const result = campaignFormSchema.parse({ ...valid, status: s });
      expect(result.status).toBe(s);
    }
  });

  it('accepts optional time window fields', () => {
    const result = campaignFormSchema.parse({
      ...valid,
      allowedStartTime: '06:00',
      allowedEndTime: '18:00',
      maxPlaysPerHour: 3,
      minMinutesBetweenRepeats: 15,
    });
    expect(result.allowedStartTime).toBe('06:00');
    expect(result.maxPlaysPerHour).toBe(3);
  });
});
