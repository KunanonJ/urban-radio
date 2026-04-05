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
import type { Album, Artist } from '@/types';

interface AlbumTableProps {
  readonly albums: readonly Album[];
  readonly artists: readonly Artist[];
  readonly loading?: boolean;
  readonly onEdit: (album: Album) => void;
  readonly onDelete: (album: Album) => void;
}

export function AlbumTable({ albums, artists, loading, onEdit, onDelete }: AlbumTableProps) {
  const artistMap = new Map(artists.map((a) => [a.id, a.name]));

  const columns: ColumnDef<Album, unknown>[] = [
    {
      accessorKey: 'title',
      header: 'Title',
    },
    {
      accessorKey: 'artistId',
      header: 'Artist',
      cell: ({ row }) => artistMap.get(row.original.artistId) ?? 'Unknown',
    },
    {
      accessorKey: 'releaseYear',
      header: 'Year',
      cell: ({ row }) => row.original.releaseYear ?? '—',
    },
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
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete(row.original)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return <DataTable columns={columns} data={albums} loading={loading} />;
}
