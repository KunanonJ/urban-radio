"use client";

import { useCallback, useMemo, useRef } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatDuration } from '@/lib/format';
import type { Track } from '@/lib/types';

const ROW_HEIGHT = 48;
const OVERSCAN = 8;
/** Used as the virtualizer's initial rect height in environments where layout
 *  hasn't measured the scroll container yet (jsdom, SSR). */
const DEFAULT_CONTAINER_HEIGHT = 640;
/** When the last visible row's index is within this many rows of the end,
 *  the table fires `onNearEnd` so the parent can call `fetchNextPage`. */
const NEAR_END_THRESHOLD = 10;

export interface VirtualizedTrackTableProps {
  tracks: Track[];
  selected: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onPlayTrack: (track: Track) => void;
  onPreviewTrack: (track: Track | null) => void;
  /** Called when the user has scrolled near the end. The parent decides whether to act. */
  onNearEnd?: () => void;
  className?: string;
}

function shortDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function bpmCell(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '—';
  return String(Math.round(value));
}

interface ColumnContext {
  selected: Set<string>;
  toggleOne: (id: string) => void;
  toggleAll: (checked: boolean) => void;
  trackIds: string[];
}

function buildColumns(ctx: ColumnContext): ColumnDef<Track>[] {
  return [
    {
      id: 'select',
      header: () => {
        const allChecked = ctx.trackIds.length > 0 && ctx.trackIds.every((id) => ctx.selected.has(id));
        return (
          <input
            type="checkbox"
            data-testid="vt-select-all"
            checked={allChecked}
            onChange={(e) => ctx.toggleAll(e.currentTarget.checked)}
            aria-label="Select all visible tracks"
            className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
          />
        );
      },
      cell: ({ row }) => {
        const id = row.original.id;
        const checked = ctx.selected.has(id);
        return (
          <input
            type="checkbox"
            data-testid={`vt-row-checkbox-${id}`}
            checked={checked}
            onClick={(e) => e.stopPropagation()}
            onChange={() => ctx.toggleOne(id)}
            aria-label={`Select ${row.original.title}`}
            className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
          />
        );
      },
      size: 44,
    },
    {
      id: 'title',
      header: 'Title',
      accessorKey: 'title',
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{row.original.title}</p>
        </div>
      ),
    },
    {
      id: 'artist',
      header: 'Artist',
      accessorKey: 'artist',
      cell: ({ row }) => (
        <p className="truncate text-sm text-muted-foreground">{row.original.artist || '—'}</p>
      ),
    },
    {
      id: 'album',
      header: 'Album',
      accessorKey: 'album',
      cell: ({ row }) => (
        <p className="truncate text-sm text-muted-foreground">{row.original.album || '—'}</p>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      // radio_tracks `genre` is the closest surfaced facet today; treat as the
      // category label until the catalog map exposes `category_id` directly.
      accessorFn: (t) => t.genre,
      cell: ({ getValue }) => (
        <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
          {String(getValue() ?? '') || '—'}
        </p>
      ),
    },
    {
      id: 'duration',
      header: () => <span className="text-right">Duration</span>,
      accessorKey: 'duration',
      cell: ({ row }) => (
        <p className="text-right font-mono text-xs text-muted-foreground tabular-nums">
          {formatDuration(row.original.duration)}
        </p>
      ),
      size: 80,
    },
    {
      id: 'bpm',
      header: () => <span className="text-right">BPM</span>,
      accessorFn: (t) => (t as Track & { bpm?: number }).bpm,
      cell: ({ getValue }) => (
        <p className="text-right font-mono text-xs text-muted-foreground tabular-nums">
          {bpmCell(getValue())}
        </p>
      ),
      size: 64,
    },
    {
      id: 'dateAdded',
      header: 'Added',
      accessorKey: 'dateAdded',
      cell: ({ row }) => (
        <p className="text-xs text-muted-foreground">{shortDate(row.original.dateAdded)}</p>
      ),
      size: 120,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      cell: () => <span className="inline-block w-6" aria-hidden />,
      size: 36,
    },
  ];
}

const GRID_TEMPLATE =
  'grid-cols-[44px_minmax(160px,2fr)_minmax(120px,1.4fr)_minmax(120px,1.4fr)_minmax(96px,0.8fr)_80px_64px_120px_36px]';

export function VirtualizedTrackTable({
  tracks,
  selected,
  onSelectionChange,
  onPlayTrack,
  onPreviewTrack,
  onNearEnd,
  className,
}: VirtualizedTrackTableProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const toggleOne = useCallback(
    (id: string) => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(next);
    },
    [onSelectionChange, selected],
  );

  const toggleAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        const next = new Set(selected);
        for (const t of tracks) next.add(t.id);
        onSelectionChange(next);
      } else {
        const next = new Set(selected);
        for (const t of tracks) next.delete(t.id);
        onSelectionChange(next);
      }
    },
    [onSelectionChange, selected, tracks],
  );

  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);

  const columns = useMemo(
    () => buildColumns({ selected, toggleOne, toggleAll, trackIds }),
    [selected, toggleOne, toggleAll, trackIds],
  );

  const table = useReactTable<Track>({
    data: tracks,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  const rowModel = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: rowModel.rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // jsdom returns 0 for layout sizes; seed an initial rect so the virtualizer
    // emits a non-empty window before the first ResizeObserver tick.
    initialRect: { width: 0, height: DEFAULT_CONTAINER_HEIGHT },
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  const handleScroll = useCallback(() => {
    if (!onNearEnd || rowModel.rows.length === 0) return;
    const items = virtualizer.getVirtualItems();
    if (items.length === 0) return;
    const lastIdx = items[items.length - 1].index;
    if (lastIdx >= rowModel.rows.length - 1 - NEAR_END_THRESHOLD) {
      onNearEnd();
    }
  }, [onNearEnd, rowModel.rows.length, virtualizer]);

  const handleRowClick = useCallback(
    (row: Row<Track>) => {
      onPlayTrack(row.original);
    },
    [onPlayTrack],
  );

  const handleRowHover = useCallback(
    (row: Row<Track>) => {
      onPreviewTrack(row.original);
    },
    [onPreviewTrack],
  );

  const handleRowLeave = useCallback(() => {
    onPreviewTrack(null);
  }, [onPreviewTrack]);

  if (tracks.length === 0) {
    // Parent renders the EmptyState; the table renders nothing so it doesn't
    // duplicate empty messaging.
    return null;
  }

  return (
    <div
      data-testid="virtualized-track-table"
      className={`surface-2 overflow-hidden rounded-xl border border-border ${className ?? ''}`}
    >
      <div
        role="row"
        className={`sticky top-0 z-10 grid ${GRID_TEMPLATE} gap-3 border-b border-border surface-3 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground`}
      >
        {table.getHeaderGroups().map((group) =>
          group.headers.map((header) => (
            <div key={header.id} role="columnheader" className="flex items-center">
              {flexRender(header.column.columnDef.header, header.getContext())}
            </div>
          )),
        )}
      </div>

      <div
        ref={containerRef}
        data-testid="virtualized-track-table-scroll"
        onScroll={handleScroll}
        className="relative h-[640px] overflow-y-auto"
      >
        <div style={{ height: `${totalHeight}px`, width: '100%', position: 'relative' }}>
          {virtualRows.map((vRow) => {
            const row = rowModel.rows[vRow.index];
            if (!row) return null;
            const isSelected = selected.has(row.original.id);
            return (
              <div
                key={row.id}
                role="row"
                data-testid="vt-row"
                data-track-id={row.original.id}
                data-selected={isSelected ? 'true' : 'false'}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${vRow.size}px`,
                  transform: `translateY(${vRow.start}px)`,
                }}
                onClick={() => handleRowClick(row)}
                onMouseEnter={() => handleRowHover(row)}
                onMouseLeave={handleRowLeave}
                className={`grid cursor-pointer ${GRID_TEMPLATE} items-center gap-3 border-b border-border/40 px-3 transition-colors hover:bg-secondary/40 ${
                  isSelected ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : ''
                }`}
              >
                {row.getVisibleCells().map((cell) => (
                  <div key={cell.id} role="cell" className="min-w-0 truncate">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { ROW_HEIGHT as VT_ROW_HEIGHT };
