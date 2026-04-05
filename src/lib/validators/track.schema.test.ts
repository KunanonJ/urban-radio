import { describe, it, expect } from 'vitest';
import { trackFormSchema } from './track.schema';

describe('trackFormSchema', () => {
  const validTrack = {
    title: 'God\'s Plan',
    artistId: 'artist-123',
    durationSec: 198,
    isExplicit: true,
    rotationCategory: 'A' as const,
    status: 'active' as const,
  };

  it('accepts valid track data', () => {
    const result = trackFormSchema.safeParse(validTrack);
    expect(result.success).toBe(true);
  });

  it('accepts track with all optional fields', () => {
    const result = trackFormSchema.safeParse({
      ...validTrack,
      albumId: 'album-1',
      genre: 'Hip-Hop',
      subgenre: 'Trap',
      mood: 'Energetic',
      language: 'English',
      bpm: 77,
      musicalKey: 'Db',
      energyLevel: 3,
      introSec: 5,
      outroSec: 10,
      hookSec: 45,
      releaseYear: 2018,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    const result = trackFormSchema.safeParse({
      ...validTrack,
      title: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty artistId', () => {
    const result = trackFormSchema.safeParse({
      ...validTrack,
      artistId: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects duration less than 1', () => {
    const result = trackFormSchema.safeParse({
      ...validTrack,
      durationSec: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects duration over 7200', () => {
    const result = trackFormSchema.safeParse({
      ...validTrack,
      durationSec: 7201,
    });
    expect(result.success).toBe(false);
  });

  it('accepts all rotation categories', () => {
    const categories = ['A', 'B', 'C', 'RECURRENT', 'GOLD', 'INACTIVE'] as const;
    for (const cat of categories) {
      const result = trackFormSchema.safeParse({
        ...validTrack,
        rotationCategory: cat,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid rotation category', () => {
    const result = trackFormSchema.safeParse({
      ...validTrack,
      rotationCategory: 'D',
    });
    expect(result.success).toBe(false);
  });

  it('rejects BPM out of range', () => {
    const tooLow = trackFormSchema.safeParse({ ...validTrack, bpm: 10 });
    const tooHigh = trackFormSchema.safeParse({ ...validTrack, bpm: 301 });
    expect(tooLow.success).toBe(false);
    expect(tooHigh.success).toBe(false);
  });

  it('accepts null albumId', () => {
    const result = trackFormSchema.safeParse({
      ...validTrack,
      albumId: null,
    });
    expect(result.success).toBe(true);
  });

  it('coerces string durationSec to number', () => {
    const result = trackFormSchema.safeParse({
      ...validTrack,
      durationSec: '180',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.durationSec).toBe(180);
    }
  });

  it('rejects all three track statuses except valid ones', () => {
    const valid = trackFormSchema.safeParse({ ...validTrack, status: 'draft' });
    const invalid = trackFormSchema.safeParse({ ...validTrack, status: 'pending' });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });

  it('validates energy level range 1-5', () => {
    const valid = trackFormSchema.safeParse({ ...validTrack, energyLevel: 3 });
    const tooLow = trackFormSchema.safeParse({ ...validTrack, energyLevel: 0 });
    const tooHigh = trackFormSchema.safeParse({ ...validTrack, energyLevel: 6 });
    expect(valid.success).toBe(true);
    expect(tooLow.success).toBe(false);
    expect(tooHigh.success).toBe(false);
  });
});
