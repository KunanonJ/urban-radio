import { describe, expect, it } from 'vitest';
import { shuffleArray } from '@/lib/utils';

describe('shuffleArray', () => {
  it('preserves length and elements', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffleArray(input);
    expect(out).toHaveLength(5);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});
