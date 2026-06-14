/**
 * Design tokens — Sonic Bloom upgrade
 *
 * Pure, additive token map. Mirrors the CSS variables defined in
 * `src/app/globals.css` and the Tailwind extensions in `tailwind.config.ts`.
 *
 * Components MUST NOT import raw values from here for runtime styling.
 * Use the corresponding Tailwind classes / CSS variables instead. This module
 * exists so that:
 *   1. Tests can lock the token contract.
 *   2. Tooling (Storybook, docs) can introspect the design system.
 */

/** Elevation utility class names — see `globals.css` `.surface-0..surface-3`. */
export const elevation = {
  0: 'surface-0',
  1: 'surface-1',
  2: 'surface-2',
  3: 'surface-3',
} as const;

/**
 * Accent keys. The first four match `data-accent` values that already exist
 * in `globals.css`. `cb-safe` is the new color-blind-safe option derived from
 * the Okabe-Ito palette (deuteranopia / tritanopia friendly).
 */
export const accents = ['green', 'cyan', 'violet', 'amber', 'cb-safe'] as const;

/** The four original accents — locked by test to prevent silent renames. */
export const baseAccents = ['green', 'cyan', 'violet', 'amber'] as const;

/**
 * Type scale — CSS custom property names exported to Tailwind via
 * `theme.extend.fontSize`. Values live in `globals.css` (`--text-*`).
 */
export const typeScale = {
  xs: '--text-xs',
  sm: '--text-sm',
  base: '--text-base',
  lg: '--text-lg',
  xl: '--text-xl',
  '2xl': '--text-2xl',
  '3xl': '--text-3xl',
} as const;

/**
 * Semantic type utility class names. These are sugar over `typeScale` for
 * common patterns and resolve via Tailwind's `fontSize` extension.
 */
export const typeUtilities = [
  'text-display',
  'text-heading',
  'text-body',
  'text-mono-sm',
] as const;

/** Box-shadow tokens registered with Tailwind (`shadow-elevation-1` etc.). */
export const elevationShadows = [
  'elevation-1',
  'elevation-2',
  'elevation-3',
] as const;

/** Background-image tokens registered with Tailwind. */
export const gradients = ['gradient-radial', 'gradient-glow'] as const;

export type ElevationLevel = keyof typeof elevation;
export type Accent = (typeof accents)[number];
export type BaseAccent = (typeof baseAccents)[number];
export type TypeScaleKey = keyof typeof typeScale;

export const designTokens = {
  elevation,
  accents,
  baseAccents,
  typeScale,
  typeUtilities,
  elevationShadows,
  gradients,
} as const;

export type DesignTokens = typeof designTokens;
