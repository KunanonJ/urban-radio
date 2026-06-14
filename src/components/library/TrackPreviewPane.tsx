"use client";

import { ListPlus, Play, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/format';
import type { Track } from '@/lib/types';

export interface TrackPreviewPaneProps {
  track: Track | null;
  onPlay?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
  onAddToCart?: (track: Track) => void;
  className?: string;
}

function shortDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

interface MetaRowProps {
  label: string;
  value: string;
}

function MetaRow({ label, value }: MetaRowProps) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/40 py-1.5 last:border-b-0">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-xs font-medium text-foreground tabular-nums text-right truncate max-w-[180px]">
        {value || '—'}
      </span>
    </div>
  );
}

export function TrackPreviewPane({
  track,
  onPlay,
  onAddToQueue,
  onAddToCart,
  className,
}: TrackPreviewPaneProps) {
  if (!track) return null;

  // `bpm`, `playCount`, and `lastPlayedAt` aren't on the public `Track` shape
  // yet — radio_tracks columns will surface them in a follow-up. Defensively
  // read from a widened shape so the pane already renders the labels.
  const extras = track as Track & {
    bpm?: number;
    playCount?: number;
    lastPlayedAt?: string;
  };

  return (
    <aside
      data-testid="track-preview-pane"
      className={`surface-2 rounded-xl border border-border p-4 ${className ?? ''}`}
      aria-label={`Preview ${track.title}`}
    >
      <header className="space-y-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Preview</p>
        <h2 className="text-lg font-semibold leading-tight text-foreground" data-testid="tpp-title">
          {track.title}
        </h2>
        <p className="text-sm text-muted-foreground" data-testid="tpp-artist">
          {track.artist || '—'}
        </p>
      </header>

      <dl className="mt-4 space-y-0">
        <MetaRow label="Album" value={track.album} />
        <MetaRow label="Category" value={track.genre} />
        <MetaRow label="Duration" value={formatDuration(track.duration)} />
        <MetaRow
          label="BPM"
          value={typeof extras.bpm === 'number' && extras.bpm > 0 ? String(Math.round(extras.bpm)) : '—'}
        />
        <MetaRow label="Year" value={track.year > 0 ? String(track.year) : '—'} />
        <MetaRow label="Added" value={shortDate(track.dateAdded)} />
        <MetaRow label="Appears on" value="— clocks" />
        <MetaRow
          label="Play count"
          value={typeof extras.playCount === 'number' ? String(extras.playCount) : '0'}
        />
        <MetaRow label="Last played" value={shortDate(extras.lastPlayedAt)} />
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          data-testid="tpp-play"
          onClick={() => onPlay?.(track)}
          className="gap-1.5"
        >
          <Play className="h-3.5 w-3.5" />
          Play
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="tpp-add-to-queue"
          onClick={() => onAddToQueue?.(track)}
          className="gap-1.5"
        >
          <ListPlus className="h-3.5 w-3.5" />
          Add to queue
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="tpp-add-to-cart"
          onClick={() => onAddToCart?.(track)}
          className="gap-1.5"
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          Add to cart
        </Button>
      </div>
    </aside>
  );
}
