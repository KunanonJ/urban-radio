'use client';

import Link from 'next/link';
import { useMemo, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useMergedTracks } from '@/lib/library';
import { usePlayerStore } from '@/lib/store';
import { useSpotScheduleStore } from '@/lib/spot-schedule-store';
import { computeNextOccurrences } from '@/lib/spot-schedule-engine';
import { Button } from '@/components/ui/button';
import { TrackRow } from '@/components/TrackRow';
import {
  AlertTriangle,
  ArrowRight,
  Library,
  Megaphone,
  Radio,
  CircleHelp,
  LayoutList,
  GanttChart,
} from 'lucide-react';
import { formatDuration } from '@/lib/format';
import {
  computeGanttBarLayout,
  shiftGanttWindowAnchor,
  type GanttScale,
} from '@/lib/gantt-timeline';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { QueueGanttTimeline } from '@/components/QueueGanttTimeline';
import { useHydrated } from '@/hooks/use-hydrated';

type QueuePreviewView = 'list' | 'gantt';

export default function HomePage() {
  const { t } = useTranslation();
  const hydrated = useHydrated();
  const [queuePreviewView, setQueuePreviewView] = useState<QueuePreviewView>('list');
  const [ganttScale, setGanttScale] = useState<GanttScale>('day');
  const [ganttAnchorDate, setGanttAnchorDate] = useState(() => new Date());
  const [ganttRefresh, setGanttRefresh] = useState(0);
  const goGanttToday = useCallback(() => {
    setGanttAnchorDate(new Date());
    setGanttRefresh((n) => n + 1);
  }, []);

  useEffect(() => {
    setGanttAnchorDate(new Date());
  }, [ganttScale]);

  const ganttNavPrev = useCallback(() => {
    setGanttAnchorDate((a) => shiftGanttWindowAnchor(ganttScale, a, -1));
  }, [ganttScale]);

  const ganttNavNext = useCallback(() => {
    setGanttAnchorDate((a) => shiftGanttWindowAnchor(ganttScale, a, 1));
  }, [ganttScale]);
  const merged = useMergedTracks();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const progress = usePlayerStore((s) => s.progress);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const getNextTrack = usePlayerStore((s) => s.getNextTrack);

  const rules = useSpotScheduleStore((s) => s.rules);

  const nextTrack = getNextTrack();

  const enabledRules = useMemo(() => rules.filter((r) => r.enabled), [rules]);

  const earliestBreak = useMemo(() => {
    let best: Date | null = null;
    for (const r of enabledRules) {
      const occ = computeNextOccurrences(r, new Date(), 1);
      const d = occ[0];
      if (d && (!best || d < best)) best = d;
    }
    return best;
  }, [enabledRules]);

  const alerts = useMemo(() => {
    const list: { key: string; message: string }[] = [];
    if (rules.length === 0) {
      list.push({ key: 'noSpots', message: t('dashboard.alertNoSpots') });
    }
    if (merged.length === 0) {
      list.push({ key: 'emptyLib', message: t('dashboard.alertEmptyLibrary') });
    }
    return list;
  }, [rules.length, merged.length, t]);

  /** All tracks from the current position onward (matches “tracks ahead” count). */
  const queuePreview = useMemo(() => queue.slice(queueIndex), [queue, queueIndex]);

  const ganttSegments = useMemo(() => {
    let offsetSec = 0;
    const items = queuePreview.map((tr, i) => {
      const durationSec = Math.max(
        1,
        i === 0 ? Math.round(tr.duration * (1 - progress)) : Math.round(tr.duration),
      );
      const startsInSec = offsetSec;
      offsetSec += durationSec;
      return { track: tr, queuePos: queueIndex + i, startsInSec, durationSec };
    });
    const totalSec = Math.max(1, offsetSec);
    return { items, totalSec };
  }, [queuePreview, queueIndex, progress]);

  const ganttBarLayout = useMemo(() => {
    void ganttRefresh;
    return computeGanttBarLayout(
      ganttScale,
      new Date(),
      ganttSegments.items.map((s) => ({ durationSec: s.durationSec })),
      ganttSegments.totalSec,
      { windowAnchorDate: ganttAnchorDate },
    );
  }, [ganttScale, ganttSegments, ganttRefresh, ganttAnchorDate]);

  const tracksAheadCount = Math.max(0, queue.length - queueIndex);

  return (
    <div className="space-y-8 app-page-dashboard">
      <div>
        <h1 className="text-3xl font-bold text-foreground">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground mt-1 max-w-[52ch]">{t('dashboard.subtitle')}</p>
      </div>

      {alerts.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            {t('dashboard.alerts')}
          </p>
          <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
            {alerts.map((a) => (
              <li key={a.key}>{a.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="surface-2 border border-border rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-primary">
            <Radio className="w-5 h-5" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t('dashboard.nowPlaying')}
            </h2>
          </div>
          {currentTrack ? (
            <div>
              <p className="text-lg font-medium text-foreground truncate">{currentTrack.title}</p>
              <p className="text-sm text-muted-foreground truncate">{currentTrack.artist}</p>
              <p className="text-xs text-muted-foreground mt-1 tabular-nums min-h-[1.25rem]">
                {hydrated
                  ? t('dashboard.approxLeft', {
                      time: formatDuration(Math.round(currentTrack.duration * (1 - progress))),
                    })
                  : '\u00a0'}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('dashboard.nothingPlaying')}</p>
          )}
        </div>

        <div className="surface-2 border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t('dashboard.upNext')}
          </h2>
          {nextTrack ? (
            <div>
              <p className="text-lg font-medium text-foreground truncate">{nextTrack.title}</p>
              <p className="text-sm text-muted-foreground truncate">{nextTrack.artist}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('dashboard.noUpNext')}</p>
          )}
        </div>

        <div className="surface-2 border border-border rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <Library className="w-5 h-5" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t('dashboard.libraryTitle')}
            </h2>
          </div>
          <p className="text-2xl font-bold text-foreground">{t('dashboard.libraryTracks', { count: merged.length })}</p>
        </div>

      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="gap-2" asChild>
          <Link href="/app/library/tracks">
            <Library className="w-4 h-4" />
            {t('dashboard.openLibrary')}
            <ArrowRight className="w-4 h-4 opacity-60" />
          </Link>
        </Button>
        <Button variant="outline" className="gap-2" asChild>
          <Link href="/app/spot-schedule">
            <Megaphone className="w-4 h-4" />
            {t('dashboard.openSpots')}
            <ArrowRight className="w-4 h-4 opacity-60" />
          </Link>
        </Button>
        <Button variant="outline" className="gap-2" asChild>
          <Link href="/app/how-to-use">
            <CircleHelp className="w-4 h-4" />
            {t('dashboard.openHowTo')}
            <ArrowRight className="w-4 h-4 opacity-60" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
              <h2 className="text-lg font-semibold text-foreground">{t('dashboard.queuePreview')}</h2>
              <ToggleGroup
                type="single"
                value={queuePreviewView}
                onValueChange={(v) => v && setQueuePreviewView(v as QueuePreviewView)}
                variant="outline"
                size="sm"
                className="shrink-0"
                aria-label={t('dashboard.queuePreview')}
              >
                <ToggleGroupItem value="list" aria-label={t('dashboard.queueViewList')}>
                  <LayoutList className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">{t('dashboard.queueViewList')}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="gantt" aria-label={t('dashboard.queueViewGantt')}>
                  <GanttChart className="w-4 h-4 sm:mr-1" />
                  <span className="hidden sm:inline">{t('dashboard.queueViewGantt')}</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <span className="text-xs text-muted-foreground sm:text-right shrink-0">
              {t('dashboard.tracksAheadInQueue', { count: tracksAheadCount })}
            </span>
          </div>
          <div
            className={cn(
              'surface-2 border border-border rounded-xl overflow-hidden',
              queuePreview.length > 0 &&
                (queuePreviewView === 'gantt' || queuePreviewView === 'list') &&
                'flex min-h-0 flex-col max-h-[min(70vh,560px)]',
            )}
          >
            {queuePreview.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground text-center">{t('dashboard.nothingPlaying')}</p>
            ) : queuePreviewView === 'list' ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {queuePreview.map((tr, i) => (
                  <TrackRow
                    key={`${tr.id}-${queueIndex + i}`}
                    track={tr}
                    index={queueIndex + i}
                    queuePosition={queueIndex + i}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col p-0">
                <p className="shrink-0 border-b border-border px-4 py-2 text-center text-[11px] text-muted-foreground tabular-nums sm:px-5">
                  {t('dashboard.ganttAxisQueued', { time: formatDuration(ganttSegments.totalSec) })}
                </p>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <QueueGanttTimeline
                    scale={ganttScale}
                    onScaleChange={setGanttScale}
                    onToday={goGanttToday}
                    onPrev={ganttNavPrev}
                    onNext={ganttNavNext}
                    layout={ganttBarLayout}
                    segments={ganttSegments.items}
                    progress={progress}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="surface-2 border border-border rounded-xl p-5 space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <Megaphone className="w-5 h-5" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {t('dashboard.spotsTitle')}
            </h2>
          </div>
          {rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dashboard.spotsNone')}</p>
          ) : (
            <>
              <p className="text-lg font-medium text-foreground">
                {t('dashboard.spotsSummary', { enabled: enabledRules.length, total: rules.length })}
              </p>
              <p className="text-sm text-muted-foreground">
                {earliestBreak
                  ? t('dashboard.nextBreakAt', { time: earliestBreak.toLocaleString() })
                  : t('dashboard.noBreakScheduled')}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
