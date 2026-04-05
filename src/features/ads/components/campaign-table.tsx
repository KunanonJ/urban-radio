'use client';

import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, Trash2, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/shared/data-table';
import { formatPercentage } from '@/lib/utils/format';
import type { Campaign, Advertiser } from '@/types';

const priorityColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  low: 'secondary',
  normal: 'default',
  high: 'destructive',
  guaranteed: 'destructive',
};

const statusColors: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline',
  active: 'default',
  paused: 'secondary',
  completed: 'secondary',
  expired: 'destructive',
};

interface CampaignTableProps {
  readonly campaigns: readonly Campaign[];
  readonly advertisers: readonly Advertiser[];
  readonly loading?: boolean;
  readonly onEdit: (campaign: Campaign) => void;
  readonly onDelete: (campaign: Campaign) => void;
}

export function CampaignTable({ campaigns, advertisers, loading, onEdit, onDelete }: CampaignTableProps) {
  const advertiserMap = new Map(advertisers.map((a) => [a.id, a.name]));

  const columns: ColumnDef<Campaign, unknown>[] = [
    {
      accessorKey: 'campaignName',
      header: 'Campaign',
      cell: ({ row }) => (
        <Link href={`/app/ads/campaigns/${row.original.id}`} className="font-medium hover:underline">
          {row.original.campaignName}
        </Link>
      ),
    },
    {
      accessorKey: 'advertiserId',
      header: 'Advertiser',
      cell: ({ row }) => advertiserMap.get(row.original.advertiserId) ?? 'Unknown',
    },
    {
      id: 'dates',
      header: 'Dates',
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.startDate} — {row.original.endDate}
        </span>
      ),
    },
    {
      accessorKey: 'contractedSpots',
      header: 'Contracted',
    },
    {
      accessorKey: 'priority',
      header: 'Priority',
      cell: ({ row }) => (
        <Badge variant={priorityColors[row.original.priority]}>
          {row.original.priority}
        </Badge>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={statusColors[row.original.status]}>
          {row.original.status}
        </Badge>
      ),
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
            <Link href={`/app/ads/campaigns/${row.original.id}`}>
              <DropdownMenuItem>
                <Eye className="mr-2 h-4 w-4" /> View
              </DropdownMenuItem>
            </Link>
            <DropdownMenuItem onClick={() => onEdit(row.original)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(row.original)}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return <DataTable columns={columns} data={campaigns} loading={loading} />;
}
