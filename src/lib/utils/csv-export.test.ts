import { describe, it, expect } from 'vitest';
import { toCSV, aggregateFulfillment } from './csv-export';

describe('toCSV', () => {
  it('generates CSV from array of objects', () => {
    const rows = [
      { name: 'Alice', age: 30, city: 'NYC' },
      { name: 'Bob', age: 25, city: 'LA' },
    ];
    const csv = toCSV(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('name,age,city');
    expect(lines[1]).toBe('Alice,30,NYC');
    expect(lines[2]).toBe('Bob,25,LA');
  });

  it('handles custom column labels', () => {
    const rows = [{ name: 'Alice', age: 30 }];
    const csv = toCSV(rows, [
      { key: 'name', label: 'Full Name' },
      { key: 'age', label: 'Age (years)' },
    ]);
    expect(csv.split('\n')[0]).toBe('Full Name,Age (years)');
  });

  it('escapes values with commas', () => {
    const rows = [{ name: 'Doe, Jane', city: 'NYC' }];
    const csv = toCSV(rows);
    expect(csv).toContain('"Doe, Jane"');
  });

  it('escapes values with quotes', () => {
    const rows = [{ name: 'She said "hi"', city: 'NYC' }];
    const csv = toCSV(rows);
    expect(csv).toContain('"She said ""hi"""');
  });

  it('escapes values with newlines', () => {
    const rows = [{ name: 'Line 1\nLine 2', city: 'NYC' }];
    const csv = toCSV(rows);
    expect(csv).toContain('"Line 1\nLine 2"');
  });

  it('returns empty string for empty array', () => {
    expect(toCSV([])).toBe('');
  });

  it('handles null/undefined values', () => {
    const rows = [{ name: 'Alice', age: null as unknown }];
    const csv = toCSV(rows as Record<string, unknown>[]);
    expect(csv).toContain('Alice,');
  });
});

describe('aggregateFulfillment', () => {
  it('calculates fulfillment percentages', () => {
    const campaigns = [
      { campaignName: 'Spring Sale', advertiserId: 'adv-1', contractedSpots: 100 },
      { campaignName: 'Summer Promo', advertiserId: 'adv-2', contractedSpots: 50 },
    ];
    const advertiserNames = new Map([['adv-1', 'Acme Corp'], ['adv-2', 'Beta Inc']]);
    const scheduledCounts = new Map([['Spring Sale', 80], ['Summer Promo', 30]]);
    const playedCounts = new Map([['Spring Sale', 75], ['Summer Promo', 45]]);

    const result = aggregateFulfillment(campaigns, advertiserNames, scheduledCounts, playedCounts);

    expect(result).toHaveLength(2);
    expect(result[0]?.advertiserName).toBe('Acme Corp');
    expect(result[0]?.played).toBe(75);
    expect(result[0]?.fulfillmentPct).toBe('75%');
    expect(result[1]?.fulfillmentPct).toBe('90%');
  });

  it('handles zero contracted spots', () => {
    const campaigns = [{ campaignName: 'Test', advertiserId: 'adv-1', contractedSpots: 0 }];
    const result = aggregateFulfillment(campaigns, new Map(), new Map(), new Map());
    expect(result[0]?.fulfillmentPct).toBe('0%');
  });

  it('handles unknown advertiser', () => {
    const campaigns = [{ campaignName: 'Test', advertiserId: 'unknown', contractedSpots: 10 }];
    const result = aggregateFulfillment(campaigns, new Map(), new Map(), new Map());
    expect(result[0]?.advertiserName).toBe('Unknown');
  });
});
