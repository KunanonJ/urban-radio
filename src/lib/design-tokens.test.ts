import { describe, expect, it } from 'vitest';
import {
  designTokens,
  elevation,
  accents,
  baseAccents,
  typeScale,
  typeUtilities,
  elevationShadows,
  gradients,
} from '@/lib/design-tokens';

describe('designTokens', () => {
  it('exposes 4 elevation levels (surface-0 through surface-3)', () => {
    expect(Object.keys(elevation)).toHaveLength(4);
    expect(elevation[0]).toBe('surface-0');
    expect(elevation[1]).toBe('surface-1');
    expect(elevation[2]).toBe('surface-2');
    expect(elevation[3]).toBe('surface-3');
  });

  it('includes color-blind-safe accent in the accent list', () => {
    expect(accents).toContain('cb-safe');
    // 4 base + 1 cb-safe = 5
    expect(accents).toHaveLength(5);
  });

  it('keeps the 4 base accents unchanged', () => {
    // Lock the contract: green, cyan, violet, amber (in that order).
    expect(baseAccents).toEqual(['green', 'cyan', 'violet', 'amber']);
    // And they must all be present in the full accent list.
    for (const accent of baseAccents) {
      expect(accents).toContain(accent);
    }
  });

  it('exposes a type scale mapped to CSS variables (--text-*)', () => {
    expect(Object.keys(typeScale)).toEqual([
      'xs',
      'sm',
      'base',
      'lg',
      'xl',
      '2xl',
      '3xl',
    ]);
    for (const variable of Object.values(typeScale)) {
      expect(variable).toMatch(/^--text-/);
    }
  });

  it('exposes semantic type utility class names', () => {
    expect(typeUtilities).toContain('text-display');
    expect(typeUtilities).toContain('text-heading');
    expect(typeUtilities).toContain('text-body');
    expect(typeUtilities).toContain('text-mono-sm');
  });

  it('exposes 3 elevation shadow tokens', () => {
    expect(elevationShadows).toEqual([
      'elevation-1',
      'elevation-2',
      'elevation-3',
    ]);
  });

  it('exposes gradient background-image tokens', () => {
    expect(gradients).toContain('gradient-radial');
    expect(gradients).toContain('gradient-glow');
  });

  it('aggregated designTokens object snapshot is stable', () => {
    expect(designTokens).toMatchInlineSnapshot(`
      {
        "accents": [
          "green",
          "cyan",
          "violet",
          "amber",
          "cb-safe",
        ],
        "baseAccents": [
          "green",
          "cyan",
          "violet",
          "amber",
        ],
        "elevation": {
          "0": "surface-0",
          "1": "surface-1",
          "2": "surface-2",
          "3": "surface-3",
        },
        "elevationShadows": [
          "elevation-1",
          "elevation-2",
          "elevation-3",
        ],
        "gradients": [
          "gradient-radial",
          "gradient-glow",
        ],
        "typeScale": {
          "2xl": "--text-2xl",
          "3xl": "--text-3xl",
          "base": "--text-base",
          "lg": "--text-lg",
          "sm": "--text-sm",
          "xl": "--text-xl",
          "xs": "--text-xs",
        },
        "typeUtilities": [
          "text-display",
          "text-heading",
          "text-body",
          "text-mono-sm",
        ],
      }
    `);
  });
});
