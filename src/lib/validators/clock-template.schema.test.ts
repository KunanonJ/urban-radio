import { describe, it, expect } from 'vitest';
import {
  clockTemplateFormSchema,
  segmentFormSchema,
  totalSegmentDuration,
  validateHourDuration,
} from './clock-template.schema';

describe('clockTemplateFormSchema', () => {
  const valid = {
    name: 'Morning Drive',
    description: 'Standard morning template',
    daypart: 'Morning',
    timezone: 'America/Chicago',
  };

  it('accepts valid template', () => {
    const result = clockTemplateFormSchema.parse(valid);
    expect(result.name).toBe('Morning Drive');
  });

  it('requires name', () => {
    expect(() => clockTemplateFormSchema.parse({ ...valid, name: '' })).toThrow();
  });

  it('rejects name longer than 200 chars', () => {
    expect(() => clockTemplateFormSchema.parse({ ...valid, name: 'x'.repeat(201) })).toThrow();
  });

  it('requires timezone', () => {
    expect(() => clockTemplateFormSchema.parse({ ...valid, timezone: '' })).toThrow();
  });

  it('allows optional fields to be omitted', () => {
    const result = clockTemplateFormSchema.parse({ name: 'Minimal', timezone: 'UTC' });
    expect(result.name).toBe('Minimal');
  });
});

describe('segmentFormSchema', () => {
  const valid = {
    id: 'seg-1',
    type: 'song' as const,
    label: 'Song Slot A',
    targetDurationSec: 210,
    position: 0,
  };

  it('accepts valid segment', () => {
    const result = segmentFormSchema.parse(valid);
    expect(result.type).toBe('song');
  });

  it('requires label', () => {
    expect(() => segmentFormSchema.parse({ ...valid, label: '' })).toThrow();
  });

  it('rejects duration below 1', () => {
    expect(() => segmentFormSchema.parse({ ...valid, targetDurationSec: 0 })).toThrow();
  });

  it('rejects duration above 3600', () => {
    expect(() => segmentFormSchema.parse({ ...valid, targetDurationSec: 3601 })).toThrow();
  });

  it('coerces duration from string', () => {
    const result = segmentFormSchema.parse({ ...valid, targetDurationSec: '180' });
    expect(result.targetDurationSec).toBe(180);
  });

  it('accepts all segment types', () => {
    const types = ['song', 'ad_break', 'jingle', 'news', 'talk_break', 'promo', 'filler'] as const;
    for (const t of types) {
      const result = segmentFormSchema.parse({ ...valid, type: t });
      expect(result.type).toBe(t);
    }
  });

  it('rejects invalid segment type', () => {
    expect(() => segmentFormSchema.parse({ ...valid, type: 'podcast' })).toThrow();
  });

  it('accepts optional rotation category', () => {
    const result = segmentFormSchema.parse({ ...valid, rotationCategory: 'A' });
    expect(result.rotationCategory).toBe('A');
  });

  it('accepts optional slot count', () => {
    const result = segmentFormSchema.parse({ ...valid, type: 'ad_break', slotCount: 3 });
    expect(result.slotCount).toBe(3);
  });
});

describe('totalSegmentDuration', () => {
  it('sums durations correctly', () => {
    const segments = [
      { targetDurationSec: 210 },
      { targetDurationSec: 180 },
      { targetDurationSec: 60 },
    ];
    expect(totalSegmentDuration(segments)).toBe(450);
  });

  it('returns 0 for empty array', () => {
    expect(totalSegmentDuration([])).toBe(0);
  });
});

describe('validateHourDuration', () => {
  it('returns null for exactly 3600s', () => {
    expect(validateHourDuration(3600)).toBeNull();
  });

  it('returns error for overflow', () => {
    const result = validateHourDuration(3700);
    expect(result?.level).toBe('error');
    expect(result?.message).toContain('exceeds');
    expect(result?.message).toContain('100s');
  });

  it('returns warning for underflow', () => {
    const result = validateHourDuration(3500);
    expect(result?.level).toBe('warning');
    expect(result?.message).toContain('100s short');
  });

  it('returns warning for zero duration', () => {
    const result = validateHourDuration(0);
    expect(result?.level).toBe('warning');
  });
});
