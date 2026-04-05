/**
 * Generates a CSV string from an array of objects.
 * Uses the keys of the first object as column headers.
 */
export function toCSV<T extends object>(
  rows: readonly T[],
  columns?: readonly { key: keyof T & string; label: string }[],
): string {
  if (rows.length === 0) return '';

  const cols = columns ?? (Object.keys(rows[0]!) as (keyof T & string)[]).map((key) => ({ key, label: key as string }));
  const header = cols.map((c) => escapeCSV(c.label)).join(',');
  const body = rows.map((row) =>
    cols.map((c) => escapeCSV(String((row as Record<string, unknown>)[c.key] ?? ''))).join(','),
  );

  return [header, ...body].join('\n');
}

function escapeCSV(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Triggers a CSV file download in the browser.
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Aggregates campaign fulfillment data.
 */
export interface FulfillmentRow {
  readonly advertiserName: string;
  readonly campaignName: string;
  readonly contracted: number;
  readonly scheduled: number;
  readonly played: number;
  readonly fulfillmentPct: string;
}

export function aggregateFulfillment(
  campaigns: readonly {
    campaignName: string;
    advertiserId: string;
    contractedSpots: number;
  }[],
  advertiserNames: ReadonlyMap<string, string>,
  scheduledCounts: ReadonlyMap<string, number>,
  playedCounts: ReadonlyMap<string, number>,
): FulfillmentRow[] {
  return campaigns.map((c) => {
    const scheduled = scheduledCounts.get(c.campaignName) ?? 0;
    const played = playedCounts.get(c.campaignName) ?? 0;
    const pct = c.contractedSpots > 0
      ? Math.round((played / c.contractedSpots) * 100)
      : 0;
    return {
      advertiserName: advertiserNames.get(c.advertiserId) ?? 'Unknown',
      campaignName: c.campaignName,
      contracted: c.contractedSpots,
      scheduled,
      played,
      fulfillmentPct: `${pct}%`,
    };
  });
}
