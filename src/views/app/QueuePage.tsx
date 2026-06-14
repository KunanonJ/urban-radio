"use client";
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePlayerStore } from '@/lib/store';
import { getRemainingQueueSeconds } from '@/lib/queue-utils';
import { ListMusic } from 'lucide-react';
import { SortableQueueList } from '@/components/queue/SortableQueueList';
import { formatHMS } from '@/lib/format';

function QueueColumnHeaders({ showDrag }: { showDrag: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/20 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
      role="row"
    >
      {showDrag && <div className="w-8 shrink-0" aria-hidden />}
      <div className="w-8 text-center shrink-0">{t('queue.headers.number')}</div>
      <div className="w-10 shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">{t('queue.headers.title')}</div>
      <div className="w-[200px] hidden lg:block truncate">{t('queue.headers.album')}</div>
      <div className="w-[104px] shrink-0 text-right hidden md:block">
        <span className="block">{t('queue.headers.start')}</span>
        <span className="block font-normal normal-case tracking-normal text-[10px] text-muted-foreground/90 mt-0.5">
          {t('queue.headers.startsIn')}
        </span>
      </div>
      <div className="w-12 text-right shrink-0">{t('queue.headers.time')}</div>
      <div className="w-7 shrink-0" aria-hidden />
    </div>
  );
}

export default function QueuePage() {
  const { t } = useTranslation();
  const { queue, queueIndex, currentTrack, progress, shuffle } = usePlayerStore();

  const remainingTotal = useMemo(
    () => getRemainingQueueSeconds(queue, queueIndex, progress, currentTrack),
    [queue, queueIndex, progress, currentTrack],
  );

  const trackCountLabel =
    queue.length === 1 ? t('queue.oneTrack', { count: 1 }) : t('queue.nTracks', { count: queue.length });

  const showDrag = queue.length > 0 && !shuffle;

  return (
    <div className="app-page" data-testid="queue-page">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-6">
        <div className="flex items-center gap-3">
          <ListMusic className="w-6 h-6 text-primary shrink-0" />
          <h1 className="text-3xl font-bold text-foreground">{t('queue.title')}</h1>
        </div>
        <span className="text-sm text-muted-foreground">
          {trackCountLabel}
          {queue.length > 0 && (
            <>
              {' · '}
              <span className="tabular-nums">{formatHMS(remainingTotal)}</span>{' '}
              {t('queue.playingTimeLeftSuffix')}
            </>
          )}
        </span>
      </div>

      <p className="text-[11px] text-muted-foreground mb-3 max-w-[60ch]" data-testid="queue-reorder-hint">
        {t('queue.reorderHint')}
      </p>

      {queue.length === 0 ? (
        <div className="surface-2 border border-border rounded-xl p-12 text-center">
          <ListMusic className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">{t('queue.empty')}</p>
        </div>
      ) : (
        <div className="surface-2 border border-border rounded-xl overflow-hidden">
          <QueueColumnHeaders showDrag={showDrag} />
          <SortableQueueList queue={queue} queueIndex={queueIndex} progress={progress} currentTrack={currentTrack} />
        </div>
      )}
    </div>
  );
}
