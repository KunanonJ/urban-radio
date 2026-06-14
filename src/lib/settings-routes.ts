/**
 * Catalog of settings sections rendered in the Linear-style left rail.
 *
 * The base /app/settings page reads the URL section param (defaulting to
 * "station") and renders the matching section. Legacy routes
 * /app/settings/{playback,appearance,integrations} continue to work via
 * their own page files; their entries are kept here so the left rail can
 * link to them when needed.
 */
export type SettingsSectionId =
  | 'station'
  | 'streams'
  | 'talent'
  | 'integrations'
  | 'imaging'
  | 'compliance'
  | 'audio'
  | 'billing'
  | 'playback'
  | 'appearance';

export interface SettingsRoute {
  /** Stable section identifier — also the URL segment under /app/settings. */
  id: SettingsSectionId;
  /** i18n key for the left-rail label, under settings.sections.*. */
  labelKey: string;
  /** Lucide icon name (lowercase, no React import here to keep this file pure). */
  iconName: string;
  /** Canonical path under the app router. */
  path: string;
  /** i18n key for the section's one-line description. */
  descriptionKey: string;
}

/**
 * Ordered list of settings sections. Order is intentional — it matches
 * the visual order in the left rail.
 */
export const SETTINGS_ROUTES: readonly SettingsRoute[] = [
  {
    id: 'station',
    labelKey: 'settings.sections.station',
    iconName: 'radio-tower',
    path: '/app/settings/station',
    descriptionKey: 'settings.sectionDescriptions.station',
  },
  {
    id: 'streams',
    labelKey: 'settings.sections.streams',
    iconName: 'radio',
    path: '/app/settings/streams',
    descriptionKey: 'settings.sectionDescriptions.streams',
  },
  {
    id: 'talent',
    labelKey: 'settings.sections.talent',
    iconName: 'users',
    path: '/app/settings/talent',
    descriptionKey: 'settings.sectionDescriptions.talent',
  },
  {
    id: 'integrations',
    labelKey: 'settings.sections.integrations',
    iconName: 'plug',
    path: '/app/settings/integrations',
    descriptionKey: 'settings.sectionDescriptions.integrations',
  },
  {
    id: 'imaging',
    labelKey: 'settings.sections.imaging',
    iconName: 'megaphone',
    path: '/app/settings/imaging',
    descriptionKey: 'settings.sectionDescriptions.imaging',
  },
  {
    id: 'compliance',
    labelKey: 'settings.sections.compliance',
    iconName: 'shield-check',
    path: '/app/settings/compliance',
    descriptionKey: 'settings.sectionDescriptions.compliance',
  },
  {
    id: 'audio',
    labelKey: 'settings.sections.audio',
    iconName: 'sliders-horizontal',
    path: '/app/settings/audio',
    descriptionKey: 'settings.sectionDescriptions.audio',
  },
  {
    id: 'billing',
    labelKey: 'settings.sections.billing',
    iconName: 'credit-card',
    path: '/app/settings/billing',
    descriptionKey: 'settings.sectionDescriptions.billing',
  },
  {
    id: 'playback',
    labelKey: 'settings.sections.playback',
    iconName: 'play-circle',
    path: '/app/settings/playback',
    descriptionKey: 'settings.sectionDescriptions.playback',
  },
  {
    id: 'appearance',
    labelKey: 'settings.sections.appearance',
    iconName: 'palette',
    path: '/app/settings/appearance',
    descriptionKey: 'settings.sectionDescriptions.appearance',
  },
] as const;

const SETTINGS_SECTION_IDS: ReadonlySet<SettingsSectionId> = new Set(
  SETTINGS_ROUTES.map((r) => r.id),
);

/** Default section shown when no URL segment is provided. */
export function getDefaultSection(): SettingsSectionId {
  return 'station';
}

/** Narrowing predicate — true when `x` is a known section id. */
export function isSettingsSectionId(x: unknown): x is SettingsSectionId {
  return typeof x === 'string' && SETTINGS_SECTION_IDS.has(x as SettingsSectionId);
}

/** Lookup helper for the section catalog. Returns undefined for unknown ids. */
export function getSettingsRoute(id: SettingsSectionId): SettingsRoute | undefined {
  return SETTINGS_ROUTES.find((r) => r.id === id);
}
