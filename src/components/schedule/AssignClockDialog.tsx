"use client";

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ConflictError,
  useCreateAssignment,
  useUpdateAssignment,
  type ScheduleAssignment,
} from '@/lib/schedule-queries';
import { useClocks } from '@/lib/clock-queries';

import { RRuleEditor } from './RRuleEditor';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export type AssignClockDialogMode = 'create' | 'edit';

export interface AttemptedSubmission {
  mode: AssignClockDialogMode;
  /** Edit-mode id; undefined for create. */
  id?: string;
  input: {
    clockId: string;
    weekday: number;
    hour: number;
    rrule: string | null;
    validFrom: string | null;
    validUntil: string | null;
  };
}

export interface AssignClockDialogProps {
  open: boolean;
  mode: AssignClockDialogMode;
  /** Required in edit mode; provides the row id and current values. */
  assignment?: ScheduleAssignment;
  weekday: number;
  hour: number;
  onClose: () => void;
  /** Called when the API returned 409. Receives both the conflicts AND the input that triggered them. */
  onConflict: (conflicts: ScheduleAssignment[], attempted: AttemptedSubmission) => void;
  onSuccess: (assignment: ScheduleAssignment) => void;
}

export function AssignClockDialog({
  open,
  mode,
  assignment,
  weekday,
  hour,
  onClose,
  onConflict,
  onSuccess,
}: AssignClockDialogProps) {
  const { t } = useTranslation();
  const clocksQuery = useClocks();
  // Memoise so the `?? []` default isn't a new array every render — keeps the
  // reset effect below from looping.
  const clocks = useMemo(
    () => clocksQuery.data?.clocks ?? [],
    [clocksQuery.data],
  );
  const createMutation = useCreateAssignment();
  const updateMutation = useUpdateAssignment();

  // Local form state — initialised from props on open / assignment change.
  const [clockId, setClockId] = useState<string>(() =>
    assignment?.clockId ?? clocks[0]?.id ?? '',
  );
  const [rrule, setRRule] = useState<string | null>(() => assignment?.rrule ?? null);
  const [validFrom, setValidFrom] = useState<string>(() => assignment?.validFrom ?? '');
  const [validUntil, setValidUntil] = useState<string>(() => assignment?.validUntil ?? '');
  const [submitting, setSubmitting] = useState(false);

  // Reset when the dialog opens or the underlying assignment changes.
  useEffect(() => {
    if (!open) return;
    setClockId(assignment?.clockId ?? clocks[0]?.id ?? '');
    setRRule(assignment?.rrule ?? null);
    setValidFrom(assignment?.validFrom ?? '');
    setValidUntil(assignment?.validUntil ?? '');
  }, [open, assignment?.id, assignment?.clockId, assignment?.rrule, assignment?.validFrom, assignment?.validUntil, clocks]);

  const noClocks = clocks.length === 0;

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    const attemptedInput = {
      clockId,
      weekday,
      hour,
      rrule,
      validFrom: validFrom || null,
      validUntil: validUntil || null,
    };
    try {
      if (mode === 'edit' && assignment) {
        const result = await updateMutation.mutateAsync({
          id: assignment.id,
          ...attemptedInput,
        });
        onSuccess(result.assignment);
      } else {
        const result = await createMutation.mutateAsync(attemptedInput);
        onSuccess(result.assignment);
      }
    } catch (err) {
      if (err instanceof ConflictError) {
        onConflict(err.conflicts, {
          mode,
          id: assignment?.id,
          input: attemptedInput,
        });
        return;
      }
      // For other errors we keep the dialog open — caller may surface a toast.
      throw err;
    } finally {
      setSubmitting(false);
    }
  }

  const weekdayLabel = t(`schedule.weekdays.${WEEKDAY_KEYS[weekday] ?? 'sun'}`);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {weekdayLabel} · {formatHourLabel(hour)}
          </DialogTitle>
          <DialogDescription>{t('schedule.selectClock')}</DialogDescription>
        </DialogHeader>

        {noClocks ? (
          <div className="rounded-md border border-border/40 bg-muted/30 p-4 text-sm">
            <p className="text-muted-foreground">{t('schedule.noClocksHint')}</p>
            <Link
              href="/app/clocks"
              className="mt-2 inline-flex text-sm font-medium text-primary hover:underline"
            >
              {t('schedule.createClock')}
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Hidden marker so tests can assert current clockId without
                interacting with Radix Select's portal-rendered list. */}
            <span className="sr-only" data-form-clock-id={clockId} />

            <div className="space-y-1.5">
              <Label htmlFor="clock-select">{t('schedule.selectClock')}</Label>
              <Select value={clockId} onValueChange={setClockId}>
                <SelectTrigger id="clock-select">
                  <SelectValue placeholder={t('schedule.selectClock')} />
                </SelectTrigger>
                <SelectContent>
                  {clocks.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <RRuleEditor value={rrule} onChange={setRRule} />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="valid-from">{t('schedule.validRange.from')}</Label>
                <Input
                  id="valid-from"
                  type="date"
                  value={validFrom}
                  onChange={(event) => setValidFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="valid-until">{t('schedule.validRange.until')}</Label>
                <Input
                  id="valid-until"
                  type="date"
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {/* Reuse existing translated copy. `schedule.actions.cancel`/`.save`
              aren't in the locale bundles yet — these keys are. */}
          <Button variant="ghost" type="button" onClick={onClose}>
            {t('settings.actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={noClocks || !clockId || submitting}
          >
            {t('clocks.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
