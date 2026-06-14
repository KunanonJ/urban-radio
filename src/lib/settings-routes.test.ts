import { describe, expect, test } from 'vitest';
import {
  SETTINGS_ROUTES,
  getDefaultSection,
  getSettingsRoute,
  isSettingsSectionId,
  type SettingsSectionId,
} from './settings-routes';

describe('settings-routes catalog', () => {
  test('SETTINGS_ROUTES includes the eight new sections plus legacy playback and appearance', () => {
    const ids = SETTINGS_ROUTES.map((r) => r.id);
    expect(ids).toEqual([
      'station',
      'streams',
      'talent',
      'integrations',
      'imaging',
      'compliance',
      'audio',
      'billing',
      'playback',
      'appearance',
    ]);
  });

  test('every route uses the /app/settings/<id> path scheme', () => {
    for (const route of SETTINGS_ROUTES) {
      expect(route.path).toBe(`/app/settings/${route.id}`);
    }
  });

  test('every route carries i18n keys under settings.sections.* and settings.sectionDescriptions.*', () => {
    for (const route of SETTINGS_ROUTES) {
      expect(route.labelKey).toBe(`settings.sections.${route.id}`);
      expect(route.descriptionKey).toBe(`settings.sectionDescriptions.${route.id}`);
    }
  });

  test('getDefaultSection returns "station"', () => {
    expect(getDefaultSection()).toBe('station');
  });

  test('isSettingsSectionId narrows known ids and rejects unknown values', () => {
    expect(isSettingsSectionId('station')).toBe(true);
    expect(isSettingsSectionId('billing')).toBe(true);
    expect(isSettingsSectionId('unknown')).toBe(false);
    expect(isSettingsSectionId(null)).toBe(false);
    expect(isSettingsSectionId(undefined)).toBe(false);
    expect(isSettingsSectionId(42)).toBe(false);
  });

  test('getSettingsRoute returns the matching route or undefined', () => {
    const station = getSettingsRoute('station');
    expect(station?.path).toBe('/app/settings/station');
    expect(getSettingsRoute('audio')?.id).toBe('audio');
    // Cast through unknown so we can ask for a deliberately invalid id.
    expect(getSettingsRoute('nope' as unknown as SettingsSectionId)).toBeUndefined();
  });
});
