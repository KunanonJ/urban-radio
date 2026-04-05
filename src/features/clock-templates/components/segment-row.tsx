'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SEGMENT_TYPES } from '@/lib/validators/clock-template.schema';
import type { SegmentFormValues } from '@/lib/validators/clock-template.schema';

const SEGMENT_TYPE_LABELS: Record<string, string> = {
  song: 'Song',
  ad_break: 'Ad Break',
  jingle: 'Jingle',
  news: 'News',
  talk_break: 'Talk Break',
  promo: 'Promo',
  filler: 'Filler',
};

const ROTATION_CATEGORIES = ['A', 'B', 'C', 'RECURRENT', 'GOLD'] as const;

interface SegmentRowProps {
  readonly segment: SegmentFormValues;
  readonly onChange: (updated: SegmentFormValues) => void;
  readonly onRemove: () => void;
}

export function SegmentRow({ segment, onChange, onRemove }: SegmentRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: segment.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function updateField<K extends keyof SegmentFormValues>(key: K, value: SegmentFormValues[K]) {
    onChange({ ...segment, [key]: value });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-md border bg-card p-2 ${isDragging ? 'opacity-50 shadow-lg' : ''}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <Select
        value={segment.type}
        onValueChange={(val) => { if (val) updateField('type', val as SegmentFormValues['type']); }}
      >
        <SelectTrigger className="w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SEGMENT_TYPES.map((t) => (
            <SelectItem key={t} value={t}>{SEGMENT_TYPE_LABELS[t] ?? t}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        className="w-[160px]"
        placeholder="Label"
        value={segment.label}
        onChange={(e) => updateField('label', e.target.value)}
      />

      <div className="flex items-center gap-1">
        <Input
          className="w-[80px]"
          type="number"
          min={1}
          max={3600}
          value={segment.targetDurationSec}
          onChange={(e) => updateField('targetDurationSec', Number(e.target.value) || 0)}
        />
        <span className="text-xs text-muted-foreground">sec</span>
      </div>

      {segment.type === 'song' && (
        <Select
          value={segment.rotationCategory ?? ''}
          onValueChange={(val) => updateField('rotationCategory', (val || undefined) as SegmentFormValues['rotationCategory'])}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Rotation" />
          </SelectTrigger>
          <SelectContent>
            {ROTATION_CATEGORIES.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {segment.type === 'ad_break' && (
        <div className="flex items-center gap-1">
          <Input
            className="w-[60px]"
            type="number"
            min={1}
            max={10}
            value={segment.slotCount ?? 1}
            onChange={(e) => updateField('slotCount', Number(e.target.value) || 1)}
          />
          <span className="text-xs text-muted-foreground">slots</span>
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ml-auto h-8 w-8 text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
