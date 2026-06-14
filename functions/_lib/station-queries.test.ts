import { describe, test, expect } from 'vitest';
import {
  buildStationGetQuery,
  buildStationUpdateQuery,
  validateIanaTimezone,
  validateLanguage,
} from './station-queries';

describe('buildStationGetQuery', () => {
  test('scopes WHERE id = ?', () => {
    const { sql, params } = buildStationGetQuery('urban-radio');
    expect(sql).toMatch(/FROM stations/);
    expect(sql).toMatch(/WHERE id = \?/);
    expect(params).toEqual(['urban-radio']);
  });

  test('selects the public station identity columns', () => {
    const { sql } = buildStationGetQuery('s');
    expect(sql).toMatch(/id/);
    expect(sql).toMatch(/org_id/);
    expect(sql).toMatch(/slug/);
    expect(sql).toMatch(/name/);
    expect(sql).toMatch(/timezone/);
    expect(sql).toMatch(/stream_url/);
    expect(sql).toMatch(/language/);
    expect(sql).toMatch(/created_at/);
  });

  test('given empty stationId > throws', () => {
    expect(() => buildStationGetQuery('')).toThrow(/stationId/);
  });
});

describe('buildStationUpdateQuery', () => {
  test('given name only > UPDATE only name column', () => {
    const { sql, params } = buildStationUpdateQuery('s', { name: 'Urban Radio' });
    expect(sql).toMatch(/UPDATE stations/);
    expect(sql).toMatch(/SET name = \?/);
    expect(sql).not.toMatch(/timezone = \?/);
    expect(sql).not.toMatch(/language = \?/);
    expect(sql).not.toMatch(/stream_url = \?/);
    expect(sql).toMatch(/WHERE id = \?/);
    expect(params).toEqual(['Urban Radio', 's']);
  });

  test('given multiple fields > UPDATE each column once, station id last', () => {
    const { sql, params } = buildStationUpdateQuery('s', {
      name: 'N',
      timezone: 'America/New_York',
      language: 'en-US',
      streamUrl: 'https://stream.example.com/live',
    });
    expect(sql).toMatch(/name = \?/);
    expect(sql).toMatch(/timezone = \?/);
    expect(sql).toMatch(/language = \?/);
    expect(sql).toMatch(/stream_url = \?/);
    expect(params[params.length - 1]).toBe('s');
    expect(params).toContain('N');
    expect(params).toContain('America/New_York');
    expect(params).toContain('en-US');
    expect(params).toContain('https://stream.example.com/live');
  });

  test('given streamUrl=null > binds NULL to clear the column', () => {
    const { sql, params } = buildStationUpdateQuery('s', { streamUrl: null });
    expect(sql).toMatch(/stream_url = \?/);
    expect(params[0]).toBeNull();
    expect(params[params.length - 1]).toBe('s');
  });

  test('given empty patch > throws empty patch error', () => {
    expect(() => buildStationUpdateQuery('s', {})).toThrow(/empty patch/);
  });

  test('given empty stationId > throws', () => {
    expect(() => buildStationUpdateQuery('', { name: 'X' })).toThrow(/stationId/);
  });
});

describe('validateIanaTimezone', () => {
  test('accepts UTC', () => {
    expect(validateIanaTimezone('UTC')).toBe(true);
  });

  test('accepts Asia/Bangkok', () => {
    expect(validateIanaTimezone('Asia/Bangkok')).toBe(true);
  });

  test('accepts America/New_York', () => {
    expect(validateIanaTimezone('America/New_York')).toBe(true);
  });

  test('rejects empty string', () => {
    expect(validateIanaTimezone('')).toBe(false);
  });

  test('rejects gibberish like Not/Real', () => {
    expect(validateIanaTimezone('Not/Real')).toBe(false);
  });

  test('rejects whitespace-only', () => {
    expect(validateIanaTimezone('   ')).toBe(false);
  });
});

describe('validateLanguage', () => {
  test('accepts en', () => {
    expect(validateLanguage('en')).toBe(true);
  });

  test('accepts en-US', () => {
    expect(validateLanguage('en-US')).toBe(true);
  });

  test('accepts zh-Hant', () => {
    expect(validateLanguage('zh-Hant')).toBe(true);
  });

  test('accepts th', () => {
    expect(validateLanguage('th')).toBe(true);
  });

  test('rejects single-letter', () => {
    expect(validateLanguage('e')).toBe(false);
  });

  test('rejects overly long values', () => {
    expect(validateLanguage('this-is-way-too-long-for-bcp47')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateLanguage('')).toBe(false);
  });

  test('rejects digits', () => {
    expect(validateLanguage('1234')).toBe(false);
  });
});
