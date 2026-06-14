import { describe, test, expect } from 'vitest';
import {
  BOM,
  CRLF,
  SUPPORTED_FORMATS,
  buildCsv,
  csvEscape,
  csvRow,
  formatDate,
  formatDurationSeconds,
  formatTime,
  getEmitter,
  isRoyaltyFormat,
} from './index';

describe('royalty dispatcher > getEmitter', () => {
  test('given format=ascap > returns ascap emitter with text/csv mime', () => {
    const e = getEmitter('ascap');
    expect(e.format).toBe('ascap');
    expect(e.mimeType).toBe('text/csv');
    expect(e.fileExtension).toBe('csv');
  });

  test('given format=bmi > returns bmi emitter', () => {
    const e = getEmitter('bmi');
    expect(e.format).toBe('bmi');
    expect(typeof e.emit).toBe('function');
  });

  test('given format=soundexchange > returns soundexchange emitter', () => {
    const e = getEmitter('soundexchange');
    expect(e.format).toBe('soundexchange');
    expect(typeof e.emit).toBe('function');
  });

  test('given invalid format > throws Error', () => {
    expect(() => getEmitter('socan' as unknown as 'ascap')).toThrowError(/Unknown royalty format/);
  });
});

describe('royalty dispatcher > isRoyaltyFormat', () => {
  test('returns true for each supported format', () => {
    for (const f of SUPPORTED_FORMATS) {
      expect(isRoyaltyFormat(f)).toBe(true);
    }
  });

  test('returns false for unsupported format strings', () => {
    expect(isRoyaltyFormat('socan')).toBe(false);
    expect(isRoyaltyFormat('')).toBe(false);
    expect(isRoyaltyFormat(undefined)).toBe(false);
    expect(isRoyaltyFormat(null)).toBe(false);
    expect(isRoyaltyFormat(42)).toBe(false);
  });
});

describe('csv helpers > csvEscape', () => {
  test('plain ASCII passes through untouched', () => {
    expect(csvEscape('hello')).toBe('hello');
  });

  test('null and undefined become empty string', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  test('numbers stringify directly', () => {
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(0)).toBe('0');
  });

  test('values containing comma are wrapped in double quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  test('values containing double quote are wrapped and doubled', () => {
    expect(csvEscape('she said "hi"')).toBe('"she said ""hi"""');
  });

  test('values containing CR or LF are wrapped', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('line1\rline2')).toBe('"line1\rline2"');
  });
});

describe('csv helpers > csvRow', () => {
  test('joins cells with commas', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c');
  });

  test('escapes only the cells that need it', () => {
    expect(csvRow(['plain', 'a,b', 'q"x'])).toBe('plain,"a,b","q""x"');
  });

  test('mixes nulls and numbers', () => {
    expect(csvRow(['a', null, 1, undefined])).toBe('a,,1,');
  });
});

describe('csv helpers > buildCsv', () => {
  test('prepends UTF-8 BOM', () => {
    const out = buildCsv(['A'], [['1']]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
  });

  test('uses CRLF line endings', () => {
    const out = buildCsv(['A', 'B'], [['1', '2']]);
    expect(out).toBe(`${BOM}A,B${CRLF}1,2${CRLF}`);
  });

  test('emits header only when there are no data rows', () => {
    const out = buildCsv(['A', 'B'], []);
    expect(out).toBe(`${BOM}A,B${CRLF}`);
  });
});

describe('csv helpers > formatDate / formatTime', () => {
  test('formats date as YYYY-MM-DD in UTC', () => {
    expect(formatDate('2026-05-13T10:00:00Z')).toBe('2026-05-13');
    expect(formatDate('2026-01-01T00:00:00Z')).toBe('2026-01-01');
  });

  test('formats time as HH:MM:SS in UTC', () => {
    expect(formatTime('2026-05-13T10:09:08Z')).toBe('10:09:08');
    expect(formatTime('2026-05-13T00:00:00Z')).toBe('00:00:00');
  });

  test('invalid input falls back to empty string', () => {
    expect(formatDate('nope')).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatTime('nope')).toBe('');
    expect(formatTime(null)).toBe('');
  });
});

describe('csv helpers > formatDurationSeconds', () => {
  test('rounds ms to whole seconds', () => {
    expect(formatDurationSeconds(180_000)).toBe('180');
    expect(formatDurationSeconds(180_400)).toBe('180');
    expect(formatDurationSeconds(180_500)).toBe('181');
    expect(formatDurationSeconds(0)).toBe('0');
  });

  test('null / undefined / non-finite → empty string', () => {
    expect(formatDurationSeconds(null)).toBe('');
    expect(formatDurationSeconds(undefined)).toBe('');
    expect(formatDurationSeconds(NaN)).toBe('');
    expect(formatDurationSeconds(Infinity)).toBe('');
  });
});
