"use client";

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { CalendarClock } from 'lucide-react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/ui/empty-state';
import { WeekGrid } from '@/components/schedule/WeekGrid';
import {
  AssignClockDialog,
  type AttemptedSubmission,
} from '@/components/schedule/AssignClockDialog';
import { ConflictResolutionDialog } from '@/components/schedule/ConflictResolutionDialog';
import {
  ConflictError,
  useCreateAssignment,
  useScheduleAssignments,
  useUpdateAssignment,
  type ScheduleAssignment,
} from '@/lib/schedule-queries';
import { useClocks } from '@/lib/clock-queries';

interface AssignTarget {
  mode: 'create' | 'edit';
  weekday: number;
  hour: number;
  assignment?: ScheduleAssignment;
}

export function SchedulePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const assignmentsQuery = useScheduleAssignments();
  const clocksQuery = useClocks();
  const createMutation = useCreateAssignment();
  const updateMutation = useUpdateAssignment();

  // Memoise the `?? []` defaults so the dependency arrays below don't change
  // every render — keeps useMemo / effects stable.
  const assignments = useMemo(
    () => assignmentsQuery.data?.assignments ?? [],
    [assignmentsQuery.data],
  );
  const clocks = useMemo(() => clocksQuery.data?.clocks ?? [], [clocksQuery.data]);

  const clockNamesById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of clocks) m[c.id] = c.name;
    return m;
  }, [clocks]);

  const [assignTarget, setAssignTarget] = useState<AssignTarget | null>(null);
  const [conflicts, setConflicts] = useState<ScheduleAssignment[]>([]);
  const [pendingSubmission, setPendingSubmission] = useState<AttemptedSubmission | null>(null);

  const handleAssignCell = useCallback((weekday: number, hour: number) => {
    setAssignTarget({ mode: 'create', weekday, hour });
  }, []);

  const handleEditCell = useCallback((assignment: ScheduleAssignment) => {
    setAssignTarget({
      mode: 'edit',
      weekday: assignment.weekday,
      hour: assignment.hour,
      assignment,
    });
  }, []);

  const closeAssignDialog = useCallback(() => {
    setAssignTarget(null);
  }, []);

  const closeConflictDialog = useCallback(() => {
    setConflicts([]);
    setPendingSubmission(null);
  }, []);

  const handleConflict = useCallback(
    (incomingConflicts: ScheduleAssignment[], attempted: AttemptedSubmission) => {
      // Stash both pieces of info so Override can replay the exact same input
      // with `force: true`, and close the assign dialog to surface the conflict
      // dialog uncluttered.
      setConflicts(incomingConflicts);
      setPendingSubmission(attempted);
      setAssignTarget(null);
    },
    [],
  );

  const handleOverride = useCallback(async () => {
    if (!pendingSubmission) {
      closeConflictDialog();
      return;
    }
    try {
      if (pendingSubmission.mode === 'edit' && pendingSubmission.id) {
        await updateMutation.mutateAsync({
          id: pendingSubmission.id,
          ...pendingSubmission.input,
          force: true,
        });
      } else {
        await createMutation.mutateAsync({
          ...pendingSubmission.input,
          force: true,
        });
      }
      toast.success('Saved');
    } catch (err) {
      if (err instanceof ConflictError) {
        // Extremely defensive — would only happen if another conflict appeared
        // between the original submission and the override replay.
        setConflicts(err.conflicts);
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to save';
      toast.error(message);
    } finally {
      setPendingSubmission(null);
      setConflicts([]);
    }
  }, [pendingSubmission, createMutation, updateMutation, closeConflictDialog]);

  const handleSuccess = useCallback((_assignment: ScheduleAssignment) => {
    toast.success('Saved');
    setAssignTarget(null);
  }, []);

  // Top-level empty state: no assignments AND no clocks → there's literally
  // nothing to schedule with, so point the user at the clocks builder.
  const showEmptyState = assignments.length === 0 && clocks.length === 0;

  return (
    <div className="app-page" data-testid="schedule-page">
      <div className="mb-6 flex items-center gap-3">
        <CalendarClock className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-3xl font-bold text-foreground">{t('schedule.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('schedule.subtitle')}</p>
        </div>
      </div>

      {showEmptyState ? (
        <EmptyState
          title={t('schedule.emptyState.title')}
          description={t('schedule.emptyState.description')}
          action={{
            label: t('schedule.emptyState.action'),
            onClick: () => router.push('/app/clocks'),
          }}
        />
      ) : (
        <WeekGrid
          assignments={assignments}
          clockNamesById={clockNamesById}
          onAssign={handleAssignCell}
          onEdit={handleEditCell}
        />
      )}

      {assignTarget ? (
        <AssignClockDialog
          open
          mode={assignTarget.mode}
          assignment={assignTarget.assignment}
          weekday={assignTarget.weekday}
          hour={assignTarget.hour}
          onClose={closeAssignDialog}
          onConflict={handleConflict}
          onSuccess={handleSuccess}
        />
      ) : null}

      <ConflictResolutionDialog
        open={conflicts.length > 0}
        conflicts={conflicts}
        clockNamesById={clockNamesById}
        onOverride={() => {
          void handleOverride();
        }}
        onCancel={closeConflictDialog}
      />
    </div>
  );
}

export default SchedulePage;
