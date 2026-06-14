import { describe, test, expect } from 'vitest';
import { validateRRule, describeRRule } from './rrule-validation';

describe('validateRRule', () => {
  test('given empty > error', () => {
    const result = validateRRule('');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/non-empty/i);
  });

  test('given non-string > error', () => {
    // Exercising the runtime guard. Cast through unknown to satisfy TS while
    // still hitting the validator at runtime with a non-string value.
    const result = validateRRule(undefined as unknown as string);
    expect(result.ok).toBe(false);
  });

  test('given "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" > ok with normalized', () => {
    const result = validateRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(result.ok).toBe(true);
    expect(result.normalized).toBeDefined();
    expect(result.normalized).toMatch(/FREQ=WEEKLY/);
    expect(result.normalized).toMatch(/BYDAY=MO,TU,WE,TH,FR/);
  });

  test('given "FREQ=DAILY;COUNT=10" > ok', () => {
    const result = validateRRule('FREQ=DAILY;COUNT=10');
    expect(result.ok).toBe(true);
    expect(result.normalized).toMatch(/FREQ=DAILY/);
    expect(result.normalized).toMatch(/COUNT=10/);
  });

  test('given "FREQ=GIBBERISH" > error', () => {
    const result = validateRRule('FREQ=GIBBERISH');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('given "FREQ=WEEKLY;BYDAY=XX" > error', () => {
    const result = validateRRule('FREQ=WEEKLY;BYDAY=XX');
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('given "RRULE:FREQ=WEEKLY" prefix > ok', () => {
    // rrulestr also accepts the "RRULE:" prefix form per RFC 5545.
    const result = validateRRule('RRULE:FREQ=WEEKLY');
    expect(result.ok).toBe(true);
    expect(result.normalized).toMatch(/FREQ=WEEKLY/);
  });
});

describe('describeRRule', () => {
  test('given weekday rule > returns human-readable string', () => {
    const description = describeRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(description).toBeTypeOf('string');
    expect(description.length).toBeGreaterThan(0);
    // Should mention weekly cadence or weekday in some form.
    expect(description.toLowerCase()).toMatch(/week|day/);
  });

  test('given invalid input > falls back to raw string', () => {
    const description = describeRRule('FREQ=GIBBERISH');
    expect(description).toBe('FREQ=GIBBERISH');
  });

  test('given empty input > returns empty string', () => {
    expect(describeRRule('')).toBe('');
  });
});
