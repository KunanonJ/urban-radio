'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/shared/data-table';
import type { Advertiser } from '@/types';

interface AdvertiserTableProps {
  readonly advertisers: readonly Advertiser[];
  readonly loading?: boolean;
  readonly onEdit: (advertiser: Advertiser) => void;
  readonly onDelete: (advertiser: Advertiser) => void;
}

export function AdvertiserTable({ advertisers, loading, onEdit, onDelete }: AdvertiserTableProps) {
  const columns: ColumnDef<Advertiser, unknown>[] = [
    { accessorKey: 'name', header: 'Company' },
    { accessorKey: 'contactName', header: 'Contact', cell: ({ row }) => row.original.contactName ?? '—' },
    { accessorKey: 'industry', header: 'Industry', cell: ({ row }) => row.original.industry ?? '—' },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.status === 'active' ? 'default' : 'secondary'}>
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

  return <DataTable columns={columns} data={advertisers} loading={loading} />;
}
