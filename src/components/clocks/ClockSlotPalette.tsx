"use client";

import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import { CSS } from '@dnd-kit/utilities';
import {
  AudioLines,
  CalendarClock,
  CloudSun,
  Music2,
  Newspaper,
  Radio,
  Megaphone,
  Mic,
  MoonStar,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CLOCK_SLOT_TYPES, type ClockSlotType } from '@/lib/clock-queries';

export interface PaletteDragData {
  kind: 'palette-slot';
  slotType: ClockSlotType;
}

interface SlotTypeMeta {
  type: ClockSlotType;
  labelKey: string;
  icon: LucideIcon;
  /**
   * Tailwind utility classes for the chip's color. Each slot type has a
   * distinct hue so the canvas and live preview can colour-code segments.
   */
  className: string;
}

export const SLOT_TYPE_META: Record<ClockSlotType, SlotTypeMeta> = {
  music: {
    type: 'music',
    labelKey: 'clocks.slotPalette.music',
    icon: Music2,
    className: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/40',
  },
  sweeper: {
    type: 'sweeper',
    labelKey: 'clocks.slotPalette.sweeper',
    icon: AudioLines,
    className: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300 border-fuchsia-500/40',
  },
  liner: {
    type: 'liner',
    labelKey: 'clocks.slotPalette.liner',
    icon: Sparkles,
    className: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/40',
  },
  vt: {
    type: 'vt',
    labelKey: 'clocks.slotPalette.vt',
    icon: Mic,
    className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/40',
  },
  id: {
    type: 'id',
    labelKey: 'clocks.slotPalette.id',
    icon: Radio,
    className: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/40',
  },
  news: {
    type: 'news',
    labelKey: 'clocks.slotPalette.news',
    icon: Newspaper,
    className: 'bg-orange-500/15 text-orange-600 dark:text-orange-300 border-orange-500/40',
  },
  weather: {
    type: 'weather',
    labelKey: 'clocks.slotPalette.weather',
    icon: CloudSun,
    className: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/40',
  },
  spot: {
    type: 'spot',
    labelKey: 'clocks.slotPalette.spot',
    icon: Megaphone,
    className: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/40',
  },
  bed: {
    type: 'bed',
    labelKey: 'clocks.slotPalette.bed',
    icon: MoonStar,
    className: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/40',
  },
  custom: {
    type: 'custom',
    labelKey: 'clocks.slotPalette.custom',
    icon: CalendarClock,
    className: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/40',
  },
};

/**
 * Default duration for a freshly-dropped slot, in ms. Three minutes is a
 * reasonable starting point for music; non-music slot types are typically
 * shorter (the user adjusts after dropping).
 */
export const DEFAULT_SLOT_DURATION_MS = 180_000;

interface PaletteChipProps {
  type: ClockSlotType;
  label: string;
  Icon: LucideIcon;
  className: string;
  onSelect?: (type: ClockSlotType) => void;
}

function PaletteChip({ type, label, Icon, className, onSelect }: PaletteChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${type}`,
    data: { kind: 'palette-slot', slotType: type } satisfies PaletteDragData,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      data-testid={`palette-chip-${type}`}
      data-slot-type={type}
      onClick={() => onSelect?.(type)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium',
        'cursor-grab touch-none transition-colors hover:bg-secondary/50 active:cursor-grabbing',
        className,
      )}
      {...attributes}
      {...listeners}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

export interface ClockSlotPaletteProps {
  /**
   * Optional click-fallback handler (keyboard/touch). Drag is the canonical
   * interaction, but exposing a click handler keeps the component testable
   * and accessible.
   */
  onAddSlot?: (slotType: ClockSlotType) => void;
}

export function ClockSlotPalette({ onAddSlot }: ClockSlotPaletteProps) {
  const { t } = useTranslation();
  return (
    <aside
      data-testid="clock-slot-palette"
      className="rounded-xl border border-border surface-1 p-3"
    >
      <h2 className="mb-3 text-sm font-semibold text-foreground">
        {t('clocks.slotPalette.title')}
      </h2>
      <div className="grid grid-cols-1 gap-2">
        {CLOCK_SLOT_TYPES.map((type) => {
          const meta = SLOT_TYPE_META[type];
          return (
            <PaletteChip
              key={type}
              type={type}
              label={t(meta.labelKey)}
              Icon={meta.icon}
              className={meta.className}
              onSelect={onAddSlot}
            />
          );
        })}
      </div>
    </aside>
  );
}

export default ClockSlotPalette;
