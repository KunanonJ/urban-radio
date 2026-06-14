'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, MoreHorizontal, Play, CheckCircle2, Archive, Trash2 } from 'lucide-react';
import { format } from 'date-fns';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import type { VoiceTrackRow, VoiceTrackStatus } from '@/lib/voice-track-queries';

export interface VoiceTrackListProps {
  tracks: VoiceTrackRow[];
  onPlay?: (track: VoiceTrackRow) => void;
  onEdit?: (track: VoiceTrackRow) => void;
  onDelete?: (id: string) => void;
  onMarkReady?: (id: string) => void;
  onArchive?: (id: string) => void;
  onCreateClick?: () => void;
}

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function statusBadgeVariant(status: VoiceTrackStatus): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'ready':
      return 'default';
    case 'aired':
      return 'secondary';
    case 'archived':
      return 'outline';
    case 'draft':
    default:
      return 'outline';
  }
}

function deriveTitle(track: VoiceTrackRow): string {
  const transcript = (track.transcript ?? '').trim();
  if (transcript.length === 0) return `Voice track ${track.id.slice(0, 8)}`;
  // First line, trimmed to a reasonable length.
  const firstLine = transcript.split(/\r?\n/, 1)[0] ?? '';
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

interface VoiceTrackRowItemProps {
  track: VoiceTrackRow;
  statusLabel: string;
  onPlay?: (track: VoiceTrackRow) => void;
  onEdit?: (track: VoiceTrackRow) => void;
  onDelete?: (id: string) => void;
  onMarkReady?: (id: string) => void;
  onArchive?: (id: string) => void;
  deleteConfirmCopy: string;
  actionLabels: {
    play: string;
    edit: string;
    markReady: string;
    archive: string;
    delete: string;
  };
}

function VoiceTrackRowItem({
  track,
  statusLabel,
  onPlay,
  onEdit,
  onDelete,
  onMarkReady,
  onArchive,
  deleteConfirmCopy,
  actionLabels,
}: VoiceTrackRowItemProps) {
  const title = deriveTitle(track);
  const created = useMemo(() => {
    try {
      return format(new Date(track.createdAt), 'PP');
    } catch {
      return track.createdAt;
    }
  }, [track.createdAt]);
  return (
    <tr
      data-testid={`vt-row-${track.id}`}
      className="border-b border-border/40 last:border-b-0"
    >
      <td className="px-3 py-2">
        <Badge variant={statusBadgeVariant(track.status)} data-testid={`vt-row-status-${track.id}`}>
          {statusLabel}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          data-testid={`vt-row-title-${track.id}`}
          className={cn(
            'text-left text-sm font-medium text-foreground hover:underline',
            !onPlay && 'pointer-events-none',
          )}
          onClick={() => onPlay?.(track)}
        >
          {title}
        </button>
        {track.aiGenerated === 1 ? (
          <span className="ml-2 inline-block rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            AI
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-sm tabular-nums text-muted-foreground">
        {formatDurationMs(track.durationMs)}
      </td>
      <td className="px-3 py-2 text-sm text-muted-foreground">{created}</td>
      <td className="px-3 py-2 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-testid={`vt-row-actions-${track.id}`}
              aria-label="Open actions menu"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              data-testid={`vt-row-play-${track.id}`}
              onSelect={() => onPlay?.(track)}
            >
              <Play className="mr-2 size-4" />
              {actionLabels.play}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid={`vt-row-edit-${track.id}`}
              onSelect={() => onEdit?.(track)}
            >
              {actionLabels.edit}
            </DropdownMenuItem>
            {track.status !== 'ready' && (
              <DropdownMenuItem
                data-testid={`vt-row-mark-ready-${track.id}`}
                onSelect={() => onMarkReady?.(track.id)}
              >
                <CheckCircle2 className="mr-2 size-4" />
                {actionLabels.markReady}
              </DropdownMenuItem>
            )}
            {track.status !== 'archived' && (
              <DropdownMenuItem
                data-testid={`vt-row-archive-${track.id}`}
                onSelect={() => onArchive?.(track.id)}
              >
                <Archive className="mr-2 size-4" />
                {actionLabels.archive}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid={`vt-row-delete-${track.id}`}
              className="text-destructive"
              onSelect={() => {
                // Lightweight confirm — a richer alert-dialog can land later
                // without changing the contract. For now this matches the
                // existing pattern in ClocksPage (browser confirm).
                if (typeof window !== 'undefined' && window.confirm(deleteConfirmCopy)) {
                  onDelete?.(track.id);
                }
              }}
            >
              <Trash2 className="mr-2 size-4" />
              {actionLabels.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

export function VoiceTrackList({
  tracks,
  onPlay,
  onEdit,
  onDelete,
  onMarkReady,
  onArchive,
  onCreateClick,
}: VoiceTrackListProps) {
  const { t } = useTranslation();

  if (tracks.length === 0) {
    return (
      <EmptyState
        title={t('voiceTracks.empty.title')}
        description={t('voiceTracks.empty.description')}
        icon={Mic}
        action={
          onCreateClick
            ? {
                label: t('voiceTracks.empty.action'),
                onClick: onCreateClick,
              }
            : undefined
        }
      />
    );
  }

  const actionLabels = {
    play: t('voiceTracks.actions.play'),
    edit: t('voiceTracks.actions.edit'),
    markReady: t('voiceTracks.actions.markReady'),
    archive: t('voiceTracks.actions.archive'),
    delete: t('voiceTracks.actions.delete'),
  };
  const deleteConfirmCopy = t('voiceTracks.actions.deleteConfirm');

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 surface-1">
      <table data-testid="vt-list" className="min-w-full divide-y divide-border/40">
        <thead>
          <tr className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">{t('voiceTracks.list.status')}</th>
            <th className="px-3 py-2 font-medium">{t('voiceTracks.list.title')}</th>
            <th className="px-3 py-2 font-medium">{t('voiceTracks.list.duration')}</th>
            <th className="px-3 py-2 font-medium">{t('voiceTracks.list.created')}</th>
            <th className="px-3 py-2 text-right font-medium">
              {t('voiceTracks.list.actions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((track) => (
            <VoiceTrackRowItem
              key={track.id}
              track={track}
              statusLabel={t(`voiceTracks.status.${track.status}`)}
              onPlay={onPlay}
              onEdit={onEdit}
              onDelete={onDelete}
              onMarkReady={onMarkReady}
              onArchive={onArchive}
              deleteConfirmCopy={deleteConfirmCopy}
              actionLabels={actionLabels}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default VoiceTrackList;
