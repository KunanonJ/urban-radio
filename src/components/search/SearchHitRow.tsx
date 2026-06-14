'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import type { SearchHit } from '@/lib/search-hits';
import { formatSpotRuleShort } from '@/lib/search-hits';
import { formatDuration } from '@/lib/format';
import { resolveTrackById } from '@/lib/resolve-track';
import { usePlayerStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { Megaphone, MoreHorizontal, Pause, Play } from 'lucide-react';
import type { Track } from '@/lib/types';
import type { SpotRule } from '@/lib/spot-schedule-engine';

type Variant = 'table' | 'compact';

function TrackHitRow({ track, index, variant }: { track: Track; index: number; variant: Variant }) {
  const { currentTrack, isPlaying, play, pause } = usePlayerStore();
  const isActive = currentTrack?.id === track.id;
  const compact = variant === 'compact';

  return (
    <tr
      className={cn(
        'group cursor-pointer border-b border-border last:border-0 transition-colors',
        isActive ? 'bg-primary/10' : 'hover:bg-secondary/80',
      )}
      onDoubleClick={() => play(track)}
    >
      <td className="w-10 px-2 py-2.5 align-middle text-center">
        <span className={`text-xs font-mono tabular-nums ${isActive ? 'text-primary' : 'text-muted-foreground'} group-hover:hidden`}>
          {index + 1}
        </span>
        <button
          type="button"
          onClick={() => (isActive && isPlaying ? pause() : play(track))}
          className="hidden group-hover:inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-background/50"
          aria-label={isActive && isPlaying ? 'Pause' : 'Play'}
        >
          {isActive && isPlaying ? <Pause className="w-4 h-4 text-primary" /> : <Play className="w-4 h-4" />}
        </button>
      </td>
      <td className="w-11 px-1 py-2 align-middle">
        <Image
          src={track.artwork}
          alt=""
          width={36}
          height={36}
          unoptimized
          loading="lazy"
          className="w-9 h-9 rounded object-cover"
        />
      </td>
      <td className="min-w-0 px-2 py-2 align-middle">
        <p className={cn('text-sm truncate font-medium', isActive ? 'text-primary' : 'text-foreground')}>{track.title}</p>
        <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
      </td>
      {!compact && (
        <td className="hidden lg:table-cell w-[28%] max-w-[240px] px-2 py-2 align-middle">
          <p className="text-sm text-muted-foreground truncate">{track.album}</p>
        </td>
      )}
      <td className="w-14 px-2 py-2 align-middle text-right tabular-nums text-sm text-muted-foreground">{formatDuration(track.duration)}</td>
      <td className="w-9 px-1 py-2 align-middle">
        <button
          type="button"
          className="p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
          aria-hidden
          tabIndex={-1}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}

function SpotHitRow({ rule, index, variant }: { rule: SpotRule; index: number; variant: Variant }) {
  const { t } = useTranslation();
  const compact = variant === 'compact';
  const firstTid = rule.trackIds[0];
  const spotTrack = firstTid ? resolveTrackById(firstTid) : null;
  const durationLabel = spotTrack ? formatDuration(spotTrack.duration) : '—';

  return (
    <tr className="group border-b border-border last:border-0 transition-colors hover:bg-secondary/80">
      <td className="w-10 px-2 py-2.5 align-middle text-center text-xs font-mono tabular-nums text-muted-foreground">{index + 1}</td>
      <td className="w-11 px-1 py-2 align-middle">
        <div className="w-9 h-9 rounded bg-muted flex items-center justify-center">
          <Megaphone className="w-4 h-4 text-muted-foreground" aria-hidden />
        </div>
      </td>
      <td className="min-w-0 px-2 py-2 align-middle">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary shrink-0">{t('search.spotBadge')}</span>
          <Link
            href="/app/spot-schedule"
            className="text-sm font-medium text-foreground truncate hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {rule.name}
          </Link>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{formatSpotRuleShort(rule)}</p>
      </td>
      {!compact && (
        <td className="hidden lg:table-cell w-[28%] max-w-[240px] px-2 py-2 align-middle">
          <p className="text-sm text-muted-foreground truncate">{t('search.spotColumnKind')}</p>
        </td>
      )}
      <td className="w-14 px-2 py-2 align-middle text-right tabular-nums text-sm text-muted-foreground">{durationLabel}</td>
      <td className="w-9 px-1 py-2 align-middle">
        <Link
          href="/app/spot-schedule"
          className="inline-flex p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
          aria-label={t('search.openSpotSchedule')}
        >
          <MoreHorizontal className="w-4 h-4" />
        </Link>
      </td>
    </tr>
  );
}

export function SearchHitRow({ hit, index, variant }: { hit: SearchHit; index: number; variant: Variant }) {
  if (hit.kind === 'track') {
    return <TrackHitRow track={hit.track} index={index} variant={variant} />;
  }
  return <SpotHitRow rule={hit.rule} index={index} variant={variant} />;
}

/** ⌘K palette: compact rows (songs + spot rules). */
export function SearchHitCompactRow({ hit, onPick }: { hit: SearchHit; onPick: () => void }) {
  const { t } = useTranslation();
  const { play } = usePlayerStore();
  if (hit.kind === 'track') {
    const tr = hit.track;
    return (
      <button
        type="button"
        className="w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg hover:bg-secondary transition-colors"
        onClick={() => {
          play(tr);
          onPick();
        }}
      >
        <Image
          src={tr.artwork}
          alt=""
          width={36}
          height={36}
          unoptimized
          className="w-9 h-9 rounded object-cover shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-foreground truncate">{tr.title}</p>
          <p className="text-xs text-muted-foreground truncate">{tr.artist}</p>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground shrink-0">{formatDuration(tr.duration)}</span>
      </button>
    );
  }
  return (
    <Link
      href="/app/spot-schedule"
      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-secondary transition-colors"
      onClick={onPick}
    >
      <div className="w-9 h-9 rounded bg-muted flex items-center justify-center shrink-0">
        <Megaphone className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-semibold uppercase text-primary shrink-0">{t('search.spotBadge')}</span>
          <span className="text-sm text-foreground truncate">{hit.rule.name}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate">{formatSpotRuleShort(hit.rule)}</p>
      </div>
    </Link>
  );
}
