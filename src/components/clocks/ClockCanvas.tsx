"use client";

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ClockSlot, ClockSlotType } from '@/lib/clock-queries';
import {
  SLOT_TYPE_META,
  type PaletteDragData,
} from './ClockSlotPalette';

/**
 * A "draft" slot is what the canvas operates on: it may not yet have a
 * server id, so we allow `id` to be a client-only string. The Builder is
 * responsible for syncing to the server.
 */
export interface ClockCanvasSlot extends ClockSlot {
  /** Set to true while this slot exists only in the local draft. */
  isLocal?: boolean;
}

export interface ClockCanvasProps {
  slots: ClockCanvasSlot[];
  /** Called when a palette chip is dropped onto the canvas. */
  onAddSlot?: (slotType: ClockSlotType) => void;
  /** Called with the reordered list (positions normalised 0..n). */
  onReorder?: (next: ClockCanvasSlot[]) => void;
  /** Called when the user clicks the remove (X) button. */
  onRemove?: (slotId: string) => void;
  /** Called when a slot field is edited (category / duration). */
  onUpdateSlot?: (slotId: string, patch: Partial<ClockSlot>) => void;
}

/**
 * Pure helper: given a current slot list and a (fromId → toId) move, return
 * a new list with positions normalised 0..n. Exported for direct testing —
 * simulating @dnd-kit drag events in jsdom is brittle and slow, so we test
 * the data transform directly and trust dnd-kit's runtime to wire it up.
 */
export function reorderSlots(
  slots: ClockCanvasSlot[],
  fromId: string,
  toId: string,
): ClockCanvasSlot[] {
  const fromIdx = slots.findIndex((s) => s.id === fromId);
  const toIdx = slots.findIndex((s) => s.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return slots;
  const next = [...slots];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next.map((s, i) => ({ ...s, position: i }));
}

interface SortableSlotProps {
  slot: ClockCanvasSlot;
  index: number;
  onRemove?: (slotId: string) => void;
  onUpdateSlot?: (slotId: string, patch: Partial<ClockSlot>) => void;
}

function SortableSlot({ slot, index, onRemove, onUpdateSlot }: SortableSlotProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: slot.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const meta = SLOT_TYPE_META[slot.slotType];
  const Icon = meta.icon;
  const durationSeconds = Math.round((slot.durationEstimateMs ?? 0) / 1000);

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`canvas-slot-${slot.id}`}
      data-slot-id={slot.id}
      data-slot-position={index}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border surface-2 p-3',
        isDragging && 'relative z-10 shadow-lg ring-1 ring-border',
      )}
    >
      <button
        type="button"
        data-testid={`canvas-drag-${slot.id}`}
        className="cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground active:cursor-grabbing"
        aria-label="Drag handle"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
          meta.className,
        )}
      >
        <Icon className="size-3" aria-hidden />
        {t(meta.labelKey)}
      </span>

      <div className="flex flex-1 flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Label
            htmlFor={`slot-${slot.id}-cat`}
            className="text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            {t('clocks.slot.category')}
          </Label>
          <Input
            id={`slot-${slot.id}-cat`}
            data-testid={`canvas-slot-${slot.id}-category`}
            type="text"
            value={slot.categoryId ?? ''}
            onChange={(e) => {
              const value = e.currentTarget.value.trim();
              onUpdateSlot?.(slot.id, { categoryId: value === '' ? null : value });
            }}
            placeholder={t('clocks.slot.noCategory')}
            className="h-8 w-32 text-sm"
          />
        </div>
        <div className="flex items-center gap-1">
          <Label
            htmlFor={`slot-${slot.id}-dur`}
            className="text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            {t('clocks.slot.duration')}
          </Label>
          <Input
            id={`slot-${slot.id}-dur`}
            data-testid={`canvas-slot-${slot.id}-duration`}
            type="number"
            min={0}
            step={1}
            value={durationSeconds}
            onChange={(e) => {
              const seconds = Math.max(0, Math.round(Number(e.currentTarget.value) || 0));
              onUpdateSlot?.(slot.id, { durationEstimateMs: seconds * 1000 });
            }}
            className="h-8 w-20 text-sm"
          />
        </div>
      </div>

      <button
        type="button"
        data-testid={`canvas-remove-${slot.id}`}
        onClick={() => onRemove?.(slot.id)}
        aria-label={t('clocks.slot.remove')}
        className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function CanvasDropZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'clock-canvas-drop' });
  return (
    <div
      ref={setNodeRef}
      data-testid="clock-canvas-drop"
      data-is-over={isOver ? 'true' : 'false'}
      className={cn(
        'min-h-[420px] rounded-xl border border-dashed border-border p-3 transition-colors',
        isOver && 'bg-primary/5 border-primary/40',
      )}
    >
      {children}
    </div>
  );
}

export function ClockCanvas({
  slots,
  onAddSlot,
  onReorder,
  onRemove,
  onUpdateSlot,
}: ClockCanvasProps) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemIds = useMemo(() => slots.map((s) => s.id), [slots]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over == null) return;
    const data = active.data?.current as PaletteDragData | undefined;

    // Palette drop: new slot.
    if (data?.kind === 'palette-slot' && over.id === 'clock-canvas-drop') {
      onAddSlot?.(data.slotType);
      return;
    }

    // Existing-slot reorder.
    if (active.id !== over.id && itemIds.includes(String(active.id))) {
      const renumbered = reorderSlots(slots, String(active.id), String(over.id));
      if (renumbered !== slots) onReorder?.(renumbered);
    }
  };

  return (
    <section
      data-testid="clock-canvas"
      className="rounded-xl border border-border surface-1 p-3"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <CanvasDropZone>
            {slots.length === 0 ? (
              <div
                data-testid="canvas-empty"
                className="flex h-full min-h-[360px] items-center justify-center text-center text-sm text-muted-foreground"
              >
                {t('clocks.canvasEmpty')}
              </div>
            ) : (
              <div className="space-y-2">
                {slots.map((slot, i) => (
                  <SortableSlot
                    key={slot.id}
                    slot={slot}
                    index={i}
                    onRemove={onRemove}
                    onUpdateSlot={onUpdateSlot}
                  />
                ))}
              </div>
            )}
          </CanvasDropZone>
        </SortableContext>
      </DndContext>
    </section>
  );
}

export default ClockCanvas;
