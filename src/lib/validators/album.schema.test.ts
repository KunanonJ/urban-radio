import { describe, it, expect } from 'vitest';
import { albumFormSchema } from './album.schema';

describe('albumFormSchema', () => {
  it('accepts valid album data', () => {
    const result = albumFormSchema.safeParse({
      title: 'Scorpion',
      artistId: 'artist-123',
      releaseYear: 2018,
      status: 'active',
    });
    expect(result.success).toBe(true);
  });

  it('accepts album without optional fields', () => {
    const result = albumFormSchema.safeParse({
      title: 'Album',
      artistId: 'artist-1',
      status: 'active',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    const result = albumFormSchema.safeParse({
      title: '',
      artistId: 'artist-1',
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty artistId', () => {
    const result = albumFormSchema.safeParse({
      title: 'Album',
      artistId: '',
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('rejects release year before 1900', () => {
    const result = albumFormSchema.safeParse({
      title: 'Album',
      artistId: 'artist-1',
      releaseYear: 1899,
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('coerces string release year to number', () => {
    const result = albumFormSchema.safeParse({
      title: 'Album',
      artistId: 'artist-1',
      releaseYear: '2020',
      status: 'active',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.releaseYear).toBe(2020);
    }
  });
});
