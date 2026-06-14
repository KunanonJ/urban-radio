"use client";

import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ScheduleAssignment } from '@/lib/schedule-queries';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

interface ConflictResolutionDialogProps {
  open: boolean;
  conflicts: ScheduleAssignment[];
  clockNamesById: Record<string, string>;
  onOverride: () => void;
  onCancel: () => void;
}

export function ConflictResolutionDialog({
  open,
  conflicts,
  clockNamesById,
  onOverride,
  onCancel,
}: ConflictResolutionDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('schedule.conflict.title')}</DialogTitle>
          <DialogDescription>{t('schedule.conflict.description')}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 max-h-64 overflow-y-auto" data-conflict-list="true">
          {conflicts.map((c) => {
            const clockName = clockNamesById[c.clockId] ?? c.clockId;
            const weekdayLabel = t(`schedule.weekdays.${WEEKDAY_KEYS[c.weekday] ?? 'sun'}`);
            return (
              <li
                key={c.id}
                data-conflict-id={c.id}
                className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-sm"
              >
                <div className="font-medium">{clockName}</div>
                <div className="text-xs text-muted-foreground">
                  {weekdayLabel} · {formatHourLabel(c.hour)}
                  {c.rrule ? ` · ${c.rrule}` : ''}
                </div>
              </li>
            );
          })}
        </ul>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onCancel} type="button">
            {t('schedule.conflict.cancel')}
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled
            data-merge-disabled="true"
            title="Coming soon"
            aria-label="Coming soon"
          >
            {t('schedule.conflict.merge')}
          </Button>
          <Button variant="destructive" onClick={onOverride} type="button">
            {t('schedule.conflict.override')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
