'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/format';
import type { GanttBarLayout, GanttScale } from '@/lib/gantt-timeline';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { Track } from '@/lib/types';
import { ChevronLeft, ChevronRight, Music2 } from 'lucide-react';

export type QueueGanttSegment = {
  track: Track;
  queuePos: number;
  startsInSec: number;
  durationSec: number;
};

const BAR_TONES = [
  'bg-primary/40 border-primary/30',
  'bg-primary/22 border-border/60',
  'bg-muted/90 border-border/50',
  'bg-secondary/95 border-border/50',
] as const;

type HeaderTick = { key: string; label: string; widthPct: number };

function buildHeaderTicks(scale: GanttScale, start: Date, end: Date): { monthRow: HeaderTick[]; dayRow: HeaderTick[] } {
  const totalMs = end.getTime() - start.getTime();
  if (totalMs <= 0) {
    return { monthRow: [{ key: 'm0', label: '', widthPct: 100 }], dayRow: [{ key: 'd0', label: '', widthPct: 100 }] };
  }

  if (scale === 'day') {
    const cells: HeaderTick[] = [];
    for (let h = 0; h < 24; h += 3) {
      cells.push({
        key: `h${h}`,
        label: `${h.toString().padStart(2, '0')}:00`,
        widthPct: (3 / 24) * 100,
      });
    }
    const monthLabel = start.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    return {
      monthRow: [{ key: 'day', label: monthLabel, widthPct: 100 }],
      dayRow: cells,
    };
  }

  if (scale === 'week') {
    const cells: HeaderTick[] = [];
    const cur = new Date(start);
    for (let i = 0; i < 7; i++) {
      cells.push({
        key: `d${i}`,
        label: cur.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
        widthPct: (1 / 7) * 100,
      });
      cur.setDate(cur.getDate() + 1);
    }
    const m0 = start.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    return {
      monthRow: [{ key: 'wk', label: m0, widthPct: 100 }],
      dayRow: cells,
    };
  }

  if (scale === 'month') {
    const cells: HeaderTick[] = [];
    const cur = new Date(start);
    while (cur < end) {
      const next = new Date(cur);
      next.setDate(next.getDate() + 1);
      const span = Math.min(next.getTime(), end.getTime()) - cur.getTime();
      cells.push({
        key: `day${cur.getDate()}-${cur.getMonth()}`,
        label: String(cur.getDate()),
        widthPct: (span / totalMs) * 100,
      });
      cur.setDate(cur.getDate() + 1);
    }
    const monthLabel = start.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    return {
      monthRow: [{ key: 'mo', label: monthLabel, widthPct: 100 }],
      dayRow: cells,
    };
  }

  /* quarter */
  const cells: HeaderTick[] = [];
  const cur = new Date(start);
  for (let i = 0; i < 3; i++) {
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const span = Math.min(next.getTime(), end.getTime()) - cur.getTime();
    cells.push({
      key: `q${i}`,
      label: cur.toLocaleString(undefined, { month: 'short' }),
      widthPct: (span / totalMs) * 100,
    });
    cur.setMonth(cur.getMonth() + 1);
    cur.setDate(1);
  }
  const qLabel = `${start.toLocaleString(undefined, { month: 'short' })} – ${new Date(end.getTime() - 1).toLocaleString(undefined, { month: 'short', year: 'numeric' })}`;
  return {
    monthRow: [{ key: 'qr', label: qLabel, widthPct: 100 }],
    dayRow: cells,
  };
}

export function QueueGanttTimeline({
  scale,
  onScaleChange,
  onToday,
  onPrev,
  onNext,
  layout,
  segments,
  progress,
}: {
  scale: GanttScale;
  onScaleChange: (s: GanttScale) => void;
  /** Call from parent so window + queue layout refresh to the current instant. */
  onToday?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  layout: GanttBarLayout;
  segments: QueueGanttSegment[];
  progress: number;
}) {
  const { t } = useTranslation();

  const { monthRow, dayRow } = useMemo(
    () => buildHeaderTicks(scale, layout.start, layout.end),
    [scale, layout.start, layout.end],
  );

  const windowSec = Math.max(layout.windowSec, 1e-6);

  const nowLinePct = Math.min(100, Math.max(0, (layout.beforeSec / windowSec) * 100));

  const rows = useMemo(() => {
    let cursor = layout.beforeSec;
    return layout.scaledItems
      .map((scaled, i) => {
        const seg = segments[i];
        if (!seg || scaled.displaySec <= 0) return null;
        const leftPct = (cursor / windowSec) * 100;
        const widthPct = (scaled.displaySec / windowSec) * 100;
        cursor += scaled.displaySec;
        const status = i === 0 ? ('playing' as const) : i === 1 ? ('upnext' as const) : ('queued' as const);
        return { seg, scaled, leftPct, widthPct, status, i };
      })
      .filter(Boolean) as {
      seg: QueueGanttSegment;
      scaled: { displaySec: number };
      leftPct: number;
      widthPct: number;
      status: 'playing' | 'upnext' | 'queued';
      i: number;
    }[];
  }, [layout, segments, windowSec]);

  const statusClass = (s: 'playing' | 'upnext' | 'queued') =>
    s === 'playing'
      ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300 border-sky-500/30'
      : s === 'upnext'
        ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-500/30'
        : 'bg-muted text-muted-foreground border-border';

  const statusLabel = (s: 'playing' | 'upnext' | 'queued') =>
    s === 'playing' ? t('dashboard.ganttStatusPlaying') : s === 'upnext' ? t('dashboard.ganttStatusUpNext') : t('dashboard.ganttStatusQueued');

  const ganttLabel = t('dashboard.queueViewGantt');

  return (
    <div className="flex h-full min-h-0 flex-col" role="region" aria-label={ganttLabel}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-3 py-2.5">
        <ToggleGroup
          type="single"
          value={scale}
          onValueChange={(v) => v && onScaleChange(v as GanttScale)}
          variant="outline"
          size="sm"
          className="justify-start"
          aria-label={t('dashboard.ganttTimelineScale')}
        >
          <ToggleGroupItem value="day">{t('dashboard.ganttScaleDay')}</ToggleGroupItem>
          <ToggleGroupItem value="week">{t('dashboard.ganttScaleWeek')}</ToggleGroupItem>
          <ToggleGroupItem value="month">{t('dashboard.ganttScaleMonth')}</ToggleGroupItem>
          <ToggleGroupItem value="quarter">{t('dashboard.ganttScaleQuarter')}</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex-1 min-w-[1rem]" />
        <Button type="button" variant="outline" size="sm" onClick={() => onToday?.()}>
          {t('dashboard.ganttToday')}
        </Button>
        <div className="flex items-center rounded-md border border-border bg-background">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-none"
            aria-label={t('dashboard.ganttNavPrev')}
            onClick={() => onPrev?.()}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-none border-l border-border"
            aria-label={t('dashboard.ganttNavNext')}
            onClick={() => onNext?.()}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {layout.scaleFactor > 0 && layout.scaleFactor < 1 && (
        <p className="shrink-0 px-3 pt-3 text-[11px] text-amber-600/90 dark:text-amber-400/90">
          {t('dashboard.ganttScaledHint')}
        </p>
      )}

      {/* Single scroll surface: trackpad / wheel scrolls vertically and horizontally on the timeline */}
      <div
        className="min-h-0 flex-1 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        data-testid="queue-gantt-scroll"
        tabIndex={0}
        aria-label={t('dashboard.ganttScrollableTimeline')}
      >
        <div className="flex w-max min-w-full">
          {/* Left: task names + status (sticky so labels stay visible when scrolling horizontally) */}
          <div
            className="sticky left-0 z-20 flex w-[min(260px,38%)] shrink-0 flex-col border-r border-border bg-background/95 shadow-[1px_0_0_hsl(var(--border))] backdrop-blur-sm dark:bg-background/90"
          >
            <div className="flex h-[4.5rem] shrink-0 flex-col justify-center border-b border-border bg-muted/10 px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('dashboard.ganttColTrack')}
              </span>
              <span className="text-[10px] text-muted-foreground/80">{t('dashboard.ganttColStatus')}</span>
            </div>
            {rows.map(({ seg, status }) => (
              <div
                key={`${seg.track.id}-${seg.queuePos}-name`}
                className="flex min-h-[3.25rem] items-center gap-2 border-b border-border bg-muted/10 px-3 py-2 last:border-b-0"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Music2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{seg.track.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{seg.track.artist}</p>
                </div>
                <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium', statusClass(status))}>
                  {statusLabel(status)}
                </span>
              </div>
            ))}
          </div>

          {/* Right: timeline (wide content drives horizontal scroll) */}
          <div className="min-w-[520px] flex-1">
            <div className="flex h-8 border-b border-border bg-muted/30">
              {monthRow.map((c) => (
                <div
                  key={c.key}
                  style={{ width: `${c.widthPct}%` }}
                  className="flex items-center border-r border-border/60 px-2 text-[11px] font-medium text-muted-foreground last:border-r-0"
                >
                  <span className="truncate">{c.label}</span>
                </div>
              ))}
            </div>
            <div className="flex h-10 border-b border-border bg-background">
              {dayRow.map((c) => (
                <div
                  key={c.key}
                  style={{ width: `${c.widthPct}%` }}
                  className="flex items-end justify-center border-r border-border/40 pb-1 text-[10px] tabular-nums text-muted-foreground last:border-r-0"
                >
                  {c.label}
                </div>
              ))}
            </div>

            {rows.map(({ seg, leftPct, widthPct, status, i }) => {
              const isNow = status === 'playing';
              const timeHint = isNow
                ? t('dashboard.approxLeft', {
                    time: formatDuration(Math.round(seg.track.duration * (1 - progress))),
                  })
                : t('dashboard.ganttStartsIn', { time: formatDuration(seg.startsInSec) });

              return (
                <div
                  key={`${seg.track.id}-${seg.queuePos}-tl`}
                  className="relative min-h-[3.25rem] border-b border-border bg-muted/5 last:border-b-0"
                >
                  <div
                    className="pointer-events-none absolute inset-0 opacity-[0.35]"
                    style={{
                      backgroundImage: `repeating-linear-gradient(90deg, hsl(var(--border) / 0.5) 0, hsl(var(--border) / 0.5) 1px, transparent 1px, transparent ${100 / Math.max(dayRow.length, 1)}%)`,
                    }}
                  />
                  <div className="relative flex h-full min-h-[3.25rem] items-center px-0.5">
                    <div
                      className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-red-500 shadow-[0_0_0_1px_rgba(239,68,68,0.25)]"
                      style={{ left: `${nowLinePct}%` }}
                      title={t('dashboard.ganttNow')}
                    />
                    <div
                      className={cn(
                        'absolute top-1/2 z-[1] flex h-9 max-w-[calc(100%-4px)] -translate-y-1/2 items-center gap-2 overflow-hidden rounded-md border px-2 shadow-sm',
                        BAR_TONES[i % BAR_TONES.length],
                      )}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: '2.5rem' }}
                      title={`${seg.track.title} · ${formatDuration(seg.durationSec)}`}
                    >
                      <span className="truncate text-[11px] font-medium leading-tight text-foreground">{seg.track.title}</span>
                      <span className="hidden shrink-0 rounded bg-background/50 px-1 text-[9px] font-medium uppercase text-muted-foreground sm:inline">
                        {statusLabel(status)}
                      </span>
                    </div>
                  </div>
                  <p className="relative z-[2] px-2 pb-1.5 pt-0 text-[10px] text-muted-foreground">{timeHint}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
