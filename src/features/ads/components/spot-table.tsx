'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/shared/data-table';
import { formatDuration } from '@/lib/utils/format';
import type { Spot, ApprovalStatus } from '@/types';

const approvalConfig: Record<ApprovalStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  approved: { label: 'Approved', variant: 'default' },
  rejected: { label: 'Rejected', variant: 'destructive' },
};

interface SpotTableProps {
  readonly spots: readonly Spot[];
  readonly loading?: boolean;
  readonly onApprove: (spot: Spot) => void;
  readonly onReject: (spot: Spot) => void;
  readonly onDelete: (spot: Spot) => void;
}

export function SpotTable({ spots, loading, onApprove, onReject, onDelete }: SpotTableProps) {
  const columns: ColumnDef<Spot, unknown>[] = [
    { accessorKey: 'title', header: 'Title' },
    {
      accessorKey: 'durationSec',
      header: 'Duration',
      cell: ({ row }) => formatDuration(row.original.durationSec),
    },
    {
      accessorKey: 'versionLabel',
      header: 'Version',
      cell: ({ row }) => row.original.versionLabel ?? '—',
    },
    {
      accessorKey: 'approvalStatus',
      header: 'Approval',
      cell: ({ row }) => {
        const cfg = approvalConfig[row.original.approvalStatus];
        return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.original.approvalStatus !== 'approved' && (
              <DropdownMenuItem onClick={() => onApprove(row.original)}>
                <CheckCircle className="mr-2 h-4 w-4 text-emerald-500" /> Approve
              </DropdownMenuItem>
            )}
            {row.original.approvalStatus !== 'rejected' && (
              <DropdownMenuItem onClick={() => onReject(row.original)}>
                <XCircle className="mr-2 h-4 w-4 text-destructive" /> Reject
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(row.original)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return <DataTable columns={columns} data={spots} loading={loading} />;
}
