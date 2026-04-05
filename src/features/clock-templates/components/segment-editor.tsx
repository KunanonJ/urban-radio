'use client';

import { useCallback, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SegmentRow } from './segment-row';
import { DurationBar } from './duration-bar';
import {
  totalSegmentDuration,
  validateHourDuration,
  type SegmentFormValues,
} from '@/lib/validators/clock-template.schema';
import type { ClockSegment } from '@/types';

interface SegmentEditorProps {
  readonly segments: readonly ClockSegment[];
  readonly onChange: (segments: ClockSegment[]) => void;
  readonly disabled?: boolean;
}

function toFormValues(seg: ClockSegment): SegmentFormValues {
  return {
    id: seg.id,
    type: seg.type,
    label: seg.label,
    targetDurationSec: seg.targetDurationSec,
    slotCount: seg.slotCount,
    rotationCategory: (seg.rules?.['rotationCategory'] as SegmentFormValues['rotationCategory']) ?? undefined,
    hardStartAtMin: seg.hardStartAtMin,
    hardEndAtMin: seg.hardEndAtMin,
    position: seg.position,
  };
}

function toClockSegment(form: SegmentFormValues): ClockSegment {
  return {
    id: form.id,
    type: form.type,
    label: form.label,
    targetDurationSec: form.targetDurationSec,
    slotCount: form.slotCount,
    hardStartAtMin: form.hardStartAtMin,
    hardEndAtMin: form.hardEndAtMin,
    position: form.position,
    rules: form.rotationCategory ? { rotationCategory: form.rotationCategory } : undefined,
  };
}

let segCounter = 0;
function newSegmentId(): string {
  segCounter += 1;
  return `seg-${Date.now()}-${segCounter}`;
}

export function SegmentEditor({ segments, onChange, disabled = false }: SegmentEditorProps) {
  const [formSegments, setFormSegments] = useState<SegmentFormValues[]>(
    () => segments.map(toFormValues),
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const commit = useCallback(
    (updated: SegmentFormValues[]) => {
      const reindexed = updated.map((s, i) => ({ ...s, position: i }));
      setFormSegments(reindexed);
      onChange(reindexed.map(toClockSegment));
    },
    [onChange],
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = formSegments.findIndex((s) => s.id === active.id);
    const newIndex = formSegments.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = [...formSegments];
    const [moved] = next.splice(oldIndex, 1);
    if (!moved) return;
    next.splice(newIndex, 0, moved);
    commit(next);
  }

  function handleSegmentChange(index: number, updated: SegmentFormValues) {
    const next = formSegments.map((s, i) => (i === index ? updated : s));
    commit(next);
  }

  function handleRemove(index: number) {
    const next = formSegments.filter((_, i) => i !== index);
    commit(next);
  }

  function handleAdd() {
    const newSeg: SegmentFormValues = {
      id: newSegmentId(),
      type: 'song',
      label: 'New Segment',
      targetDurationSec: 210,
      position: formSegments.length,
    };
    commit([...formSegments, newSeg]);
  }

  const total = totalSegmentDuration(formSegments);
  const validation = validateHourDuration(total);

  return (
    <div className="space-y-4">
      <DurationBar segments={formSegments.map(toClockSegment)} />

      {validation && (
        <div className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
          validation.level === 'error'
            ? 'border-destructive bg-destructive/10 text-destructive'
            : 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400'
        }`}>
          <Badge variant={validation.level === 'error' ? 'destructive' : 'outline'}>
            {validation.level === 'error' ? 'Error' : 'Warning'}
          </Badge>
          {validation.message}
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}
      >
        <SortableContext items={formSegments.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {formSegments.map((seg, i) => (
              <SegmentRow
                key={seg.id}
                segment={seg}
                onChange={(updated) => handleSegmentChange(i, updated)}
                onRemove={() => handleRemove(i)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Button type="button" variant="outline" onClick={handleAdd} disabled={disabled}>
        <Plus className="mr-2 h-4 w-4" /> Add Segment
      </Button>
    </div>
  );
}
