// @vitest-environment node

import { describe, expect, test } from 'vitest';

import {
  BOM,
  buildCsv,
  csvEscape,
  csvRow,
  formatDate,
  formatTime,
} from './csv';

describe('csvEscape', () => {
  test('passes through plain alphanumeric values unquoted', () => {
    expect(csvEscape('Some Title')).toBe('Some Title');
    expect(csvEscape(42)).toBe('42');
  });

  test('quotes values containing comma / quote / CR / LF', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape('a\rb')).toBe('"a\rb"');
    expect(csvEscape('a\nb')).toBe('"a\nb"');
  });

  test('null / undefined become an empty cell', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  // -------------------------------------------------------------------------
  // Pentest M-11 — CSV injection
  // -------------------------------------------------------------------------

  test('pentest M-11: leading = is defused with a quoted apostrophe prefix', () => {
    const out = csvEscape('=HYPERLINK("http://evil","click")');
    // The defused value must start with `'` (Excel treats the rest as text).
    // The presence of `,` triggers RFC-4180 quoting, so the result is a
    // quoted string beginning with `"`'`.
    expect(out.startsWith('"\'=')).toBe(true);
    expect(out).not.toMatch(/^=/);
  });

  test('pentest M-11: leading + is defused', () => {
    const out = csvEscape('+SUM(A1:A10)');
    expect(out).toBe(`'+SUM(A1:A10)`);
  });

  test('pentest M-11: leading - is defused', () => {
    const out = csvEscape('-2+3');
    expect(out).toBe(`'-2+3`);
  });

  test('pentest M-11: leading @ is defused', () => {
    const out = csvEscape('@cmd');
    expect(out).toBe(`'@cmd`);
  });

  test('pentest M-11: leading tab is defused (Excel quirk)', () => {
    const out = csvEscape('\tinjected');
    expect(out.startsWith(`'`)).toBe(true);
  });

  test('pentest M-11: leading carriage return is defused', () => {
    // Leading \r triggers both formula-defuse AND RFC-4180 quoting.
    const out = csvEscape('\rinjected');
    expect(out).toMatch(/^"'\r/);
  });

  test('pentest M-11: formula characters NOT in leading position are unchanged', () => {
    expect(csvEscape('a=b')).toBe('a=b');
    expect(csvEscape('a+b')).toBe('a+b');
    expect(csvEscape('a-b')).toBe('a-b');
    expect(csvEscape('a@b')).toBe('a@b');
  });
});

describe('csvRow', () => {
  test('joins escaped cells with commas', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c');
    expect(csvRow(['has, comma', 'plain'])).toBe('"has, comma",plain');
  });
});

describe('buildCsv', () => {
  test('emits BOM + CRLF-separated rows + trailing CRLF', () => {
    const out = buildCsv(['col1', 'col2'], [['a', 'b']]);
    expect(out.startsWith(BOM)).toBe(true);
    expect(out).toContain('col1,col2\r\n');
    expect(out).toContain('a,b\r\n');
  });
});

describe('formatDate / formatTime', () => {
  test('formatDate returns UTC YYYY-MM-DD', () => {
    expect(formatDate('2026-05-16T10:30:00Z')).toBe('2026-05-16');
    expect(formatDate(null)).toBe('');
    expect(formatDate('not-a-date')).toBe('');
  });

  test('formatTime returns UTC HH:MM:SS', () => {
    expect(formatTime('2026-05-16T10:30:45Z')).toBe('10:30:45');
    expect(formatTime(null)).toBe('');
  });
});
