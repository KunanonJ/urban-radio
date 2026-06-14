"use client";

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import type { ScheduleAssignment } from '@/lib/schedule-queries';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const HOURS = Array.from({ length: 24 }, (_v, i) => i);

interface WeekGridProps {
  assignments: ScheduleAssignment[];
  /** Map from clockId → display name. Cells fall back to the clockId if missing. */
  clockNamesById: Record<string, string>;
  onAssign: (weekday: number, hour: number) => void;
  onEdit: (assignment: ScheduleAssignment) => void;
}

/**
 * Stable lookup table keyed by `${weekday}:${hour}` so each cell is O(1).
 */
function buildCellMap(assignments: ScheduleAssignment[]): Map<string, ScheduleAssignment> {
  const m = new Map<string, ScheduleAssignment>();
  for (const a of assignments) {
    m.set(`${a.weekday}:${a.hour}`, a);
  }
  return m;
}

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function WeekGrid({ assignments, clockNamesById, onAssign, onEdit }: WeekGridProps) {
  const { t } = useTranslation();
  const cellMap = useMemo(() => buildCellMap(assignments), [assignments]);

  return (
    <div
      className="surface-1 border border-border/40 rounded-xl overflow-hidden"
      data-testid="week-grid"
    >
      {/* Header row: blank top-left + 7 weekday columns */}
      <div
        className="grid sticky top-0 z-10 surface-2 border-b border-border/40 text-xs font-semibold uppercase tracking-wide"
        style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}
      >
        <div aria-hidden className="px-2 py-2" />
        {WEEKDAY_KEYS.map((key, idx) => (
          <div
            key={key}
            data-weekday-header="true"
            data-weekday={idx}
            className="px-2 py-2 text-center"
          >
            {t(`schedule.weekdays.${key}`)}
          </div>
        ))}
      </div>

      {/* Body rows: hour label + 7 cells */}
      <div className="text-xs">
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="grid border-b border-border/30 last:border-b-0"
            style={{ gridTemplateColumns: '64px repeat(7, minmax(0, 1fr))' }}
          >
            <div className="sticky left-0 z-10 surface-2 px-2 py-2 text-right text-muted-foreground tabular-nums font-mono">
              {formatHourLabel(hour)}
            </div>
            {WEEKDAY_KEYS.map((_key, weekday) => {
              const assignment = cellMap.get(`${weekday}:${hour}`);
              const clockName = assignment
                ? clockNamesById[assignment.clockId] ?? assignment.clockId
                : '';
              return (
                <button
                  type="button"
                  key={weekday}
                  data-grid-cell="true"
                  data-weekday={weekday}
                  data-hour={hour}
                  data-occupied={assignment ? 'true' : 'false'}
                  onClick={() => {
                    if (assignment) {
                      onEdit(assignment);
                    } else {
                      onAssign(weekday, hour);
                    }
                  }}
                  className={cn(
                    'min-h-[40px] border-l border-border/30 px-2 py-1 text-left transition-colors',
                    'hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    assignment
                      ? 'bg-primary/10 text-primary-foreground/90'
                      : 'text-muted-foreground/70',
                  )}
                  aria-label={
                    assignment
                      ? `${clockName} · ${t(`schedule.weekdays.${WEEKDAY_KEYS[weekday]}`)} ${formatHourLabel(hour)}`
                      : `${t('schedule.cell.empty')} · ${t(`schedule.weekdays.${WEEKDAY_KEYS[weekday]}`)} ${formatHourLabel(hour)}`
                  }
                >
                  {assignment ? (
                    <span
                      className="inline-flex items-center rounded-md bg-primary/30 px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                      data-cell-chip="true"
                    >
                      {clockName}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
