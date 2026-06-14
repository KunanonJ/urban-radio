import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { TrackRow } from '@/components/TrackRow';
import { usePlayerStore } from '@/lib/store';
import type { Track } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatStartsAtClock, formatStartsIn } from '@/lib/format';

type RowStart =
  | { played: true }
  | { startsAtClock?: string; startsIn?: string };

function isPastQueueRow(s: RowStart): s is { played: true } {
  return 'played' in s && s.played === true;
}

function SortableQueueRow({
  id,
  track,
  index,
  shuffle,
  startsAtClock,
  startsIn,
}: {
  id: number;
  track: Track;
  index: number;
  shuffle: boolean;
  startsAtClock?: string;
  startsIn?: string;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: shuffle,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'border-b border-border last:border-b-0',
        isDragging && 'relative z-[1] bg-background/95 shadow-lg ring-1 ring-border',
      )}
    >
      <TrackRow
        track={track}
        index={index}
        queuePosition={index}
        leadingSlot={
          !shuffle ? (
            <button
              type="button"
              data-testid="queue-drag-handle"
              className="cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
              {...attributes}
              {...listeners}
              aria-label={t('queue.dragHandle')}
            >
              <GripVertical className="size-4" />
            </button>
          ) : undefined
        }
        startsAtClock={startsAtClock}
        startsIn={startsIn}
      />
    </div>
  );
}

export function SortableQueueList({
  queue,
  queueIndex,
  progress,
  currentTrack,
}: {
  queue: Track[];
  queueIndex: number;
  progress: number;
  currentTrack: Track | null;
}) {
  const { t } = useTranslation();
  const shuffle = usePlayerStore((s) => s.shuffle);
  const moveQueueItem = usePlayerStore((s) => s.moveQueueItem);

  const rowStarts: RowStart[] = useMemo(() => {
    const remaining = currentTrack ? currentTrack.duration * (1 - progress) : 0;
    return queue.map((_, i) => {
      if (i < queueIndex) return { played: true as const };
      if (i === queueIndex) return { startsAtClock: t('queue.headers.now'), startsIn: undefined };
      let offset = remaining;
      for (let j = queueIndex + 1; j < i; j++) offset += queue[j].duration;
      return { startsAtClock: formatStartsAtClock(offset), startsIn: formatStartsIn(offset) };
    });
  }, [queue, queueIndex, progress, currentTrack, t]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemIds = useMemo(() => queue.map((_, i) => i), [queue]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over == null || active.id === over.id) return;
    const from = Number(active.id);
    const to = Number(over.id);
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    moveQueueItem(from, to);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy} disabled={shuffle}>
        <div className="overflow-hidden" role="list" data-testid="queue-list">
          {queue.map((tr, i) => {
            const start = rowStarts[i];
            return (
              <SortableQueueRow
                key={`${tr.id}-${i}`}
                id={i}
                track={tr}
                index={i}
                shuffle={shuffle}
                startsAtClock={isPastQueueRow(start) ? t('queue.played') : start.startsAtClock}
                startsIn={isPastQueueRow(start) ? undefined : start.startsIn}
              />
            );
          })}
        </div>
      </SortableContext>
      {shuffle && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">{t('queue.shuffleReorderHint')}</p>
      )}
    </DndContext>
  );
}
