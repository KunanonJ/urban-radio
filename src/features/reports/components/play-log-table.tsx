'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/shared/data-table';
import { type ColumnDef } from '@tanstack/react-table';
import { toCSV, downloadCSV } from '@/lib/utils/csv-export';
import type { PlayLog } from '@/types';

interface PlayLogDisplay {
  readonly id: string;
  readonly playedAt: string;
  readonly itemType: string;
  readonly result: string;
  readonly sourceRefId: string;
}

const columns: ColumnDef<PlayLogDisplay, unknown>[] = [
  { accessorKey: 'playedAt', header: 'Played At' },
  {
    accessorKey: 'itemType',
    header: 'Type',
    cell: ({ row }) => (
      <Badge variant="outline" className="text-xs uppercase">
        {row.original.itemType}
      </Badge>
    ),
  },
  { accessorKey: 'sourceRefId', header: 'Source Ref' },
  {
    accessorKey: 'result',
    header: 'Result',
    cell: ({ row }) => {
      const variant = row.original.result === 'played' ? 'default' : 'secondary';
      return <Badge variant={variant}>{row.original.result}</Badge>;
    },
  },
];

interface PlayLogTableProps {
  readonly logs: readonly PlayLog[];
  readonly loading?: boolean;
}

export function PlayLogTable({ logs, loading }: PlayLogTableProps) {
  const displayLogs: PlayLogDisplay[] = logs.map((log) => ({
    id: log.id,
    playedAt: log.playedAt instanceof Date
      ? log.playedAt.toLocaleString()
      : String(log.playedAt),
    itemType: log.itemType,
    result: log.result,
    sourceRefId: log.sourceRefId ?? '',
  }));

  function handleExport() {
    const csv = toCSV(displayLogs, [
      { key: 'playedAt', label: 'Played At' },
      { key: 'itemType', label: 'Type' },
      { key: 'sourceRefId', label: 'Source Ref' },
      { key: 'result', label: 'Result' },
    ]);
    downloadCSV(csv, `play-log-${new Date().toISOString().split('T')[0]}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Play Log</h3>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={logs.length === 0}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>
      <DataTable columns={columns} data={displayLogs} loading={loading} />
    </div>
  );
}
