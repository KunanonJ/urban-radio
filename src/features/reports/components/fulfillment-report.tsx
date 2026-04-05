'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/shared/data-table';
import { type ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { toCSV, downloadCSV, type FulfillmentRow } from '@/lib/utils/csv-export';

const columns: ColumnDef<FulfillmentRow, unknown>[] = [
  { accessorKey: 'advertiserName', header: 'Advertiser' },
  { accessorKey: 'campaignName', header: 'Campaign' },
  { accessorKey: 'contracted', header: 'Contracted' },
  { accessorKey: 'scheduled', header: 'Scheduled' },
  { accessorKey: 'played', header: 'Played' },
  {
    accessorKey: 'fulfillmentPct',
    header: 'Fulfillment',
    cell: ({ row }) => {
      const pct = parseInt(row.original.fulfillmentPct);
      const variant = pct >= 90 ? 'default' : pct >= 50 ? 'secondary' : 'destructive';
      return <Badge variant={variant}>{row.original.fulfillmentPct}</Badge>;
    },
  },
];

interface FulfillmentReportProps {
  readonly data: readonly FulfillmentRow[];
  readonly loading?: boolean;
}

export function FulfillmentReport({ data, loading }: FulfillmentReportProps) {
  function handleExport() {
    const csv = toCSV([...data], [
      { key: 'advertiserName', label: 'Advertiser' },
      { key: 'campaignName', label: 'Campaign' },
      { key: 'contracted', label: 'Contracted' },
      { key: 'scheduled', label: 'Scheduled' },
      { key: 'played', label: 'Played' },
      { key: 'fulfillmentPct', label: 'Fulfillment %' },
    ]);
    downloadCSV(csv, `fulfillment-report-${new Date().toISOString().split('T')[0]}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Campaign Fulfillment</h3>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={data.length === 0}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>
      <DataTable columns={columns} data={data} loading={loading} />
    </div>
  );
}
