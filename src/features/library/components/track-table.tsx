'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal, Pencil, Trash2, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/shared/data-table';
import { formatDuration } from '@/lib/utils/format';
import type { Track, Artist } from '@/types';

interface TrackTableProps {
  readonly tracks: readonly Track[];
  readonly artists: readonly Artist[];
  readonly loading?: boolean;
  readonly onEdit: (track: Track) => void;
  readonly onDelete: (track: Track) => void;
  readonly onPlay?: (track: Track) => void;
}

const rotationColors: Record<string, string> = {
  A: 'default',
  B: 'secondary',
  C: 'outline',
  RECURRENT: 'secondary',
  GOLD: 'default',
  INACTIVE: 'destructive',
};

export function TrackTable({
  tracks,
  artists,
  loading,
  onEdit,
  onDelete,
  onPlay,
}: TrackTableProps) {
  const artistMap = new Map(artists.map((a) => [a.id, a.name]));

  const columns: ColumnDef<Track, unknown>[] = [
    {
      id: 'play',
      header: '',
      cell: ({ row }) =>
        onPlay ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onPlay(row.original)}
          >
            <Play className="h-4 w-4" />
          </Button>
        ) : null,
    },
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <div>
          <span className="font-medium">{row.original.title}</span>
          {row.original.isExplicit && (
            <Badge variant="destructive" className="ml-2 text-[10px]">
              E
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'artistId',
      header: 'Artist',
      cell: ({ row }) => artistMap.get(row.original.artistId) ?? 'Unknown',
    },
    {
      accessorKey: 'durationSec',
      header: 'Duration',
      cell: ({ row }) => formatDuration(row.original.durationSec),
    },
    {
      accessorKey: 'rotationCategory',
      header: 'Rotation',
      cell: ({ row }) => (
        <Badge variant={rotationColors[row.original.rotationCategory] as 'default' | 'secondary' | 'outline' | 'destructive'}>
          {row.original.rotationCategory}
        </Badge>
      ),
    },
    {
      accessorKey: 'genre',
      header: 'Genre',
      cell: ({ row }) => row.original.genre ?? '—',
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

  return <DataTable columns={columns} data={tracks} loading={loading} />;
}
