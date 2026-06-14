"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, Loader2, Save, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  useAddSlot,
  useClock,
  useDeleteClock,
  useDeleteSlot,
  useReorderSlots,
  useUpdateClock,
  useUpdateSlot,
  type ClockDetail,
  type ClockSlot,
  type ClockSlotType,
} from '@/lib/clock-queries';
import {
  ClockSlotPalette,
  DEFAULT_SLOT_DURATION_MS,
} from '@/components/clocks/ClockSlotPalette';
import { ClockCanvas, type ClockCanvasSlot } from '@/components/clocks/ClockCanvas';
import { ClockLivePreview } from '@/components/clocks/ClockLivePreview';

interface DraftState {
  name: string;
  color: string;
  targetDurationMs: number;
  slots: ClockCanvasSlot[];
}

function fromServer(clock: ClockDetail): DraftState {
  return {
    name: clock.name,
    color: clock.color,
    targetDurationMs: clock.targetDurationMs,
    slots: clock.slots.map((s) => ({ ...s, isLocal: false })),
  };
}

/**
 * Pure diff. Compares server state vs draft and emits a plan describing what
 * to do. Exported for direct testing — the side-effectful save path consumes
 * this and dispatches mutations.
 */
export interface SaveDiff {
  metadataPatch: {
    name?: string;
    color?: string;
    targetDurationMs?: number;
  } | null;
  toAdd: { tempId: string; slot: ClockCanvasSlot }[];
  toDelete: string[];
  toUpdate: { id: string; patch: Partial<ClockSlot> }[];
  /** Final desired order (server ids only after `toAdd` resolves to real ids). */
  finalOrder: { id: string; position: number; isLocal: boolean }[];
}

export function computeSaveDiff(server: ClockDetail, draft: DraftState): SaveDiff {
  const metadataPatch: SaveDiff['metadataPatch'] = {};
  if (draft.name !== server.name) metadataPatch.name = draft.name;
  if (draft.color !== server.color) metadataPatch.color = draft.color;
  if (draft.targetDurationMs !== server.targetDurationMs) {
    metadataPatch.targetDurationMs = draft.targetDurationMs;
  }
  const metaPatch = Object.keys(metadataPatch).length > 0 ? metadataPatch : null;

  const serverById = new Map(server.slots.map((s) => [s.id, s]));
  const draftById = new Map(
    draft.slots.filter((s) => !s.isLocal).map((s) => [s.id, s]),
  );

  const toAdd: SaveDiff['toAdd'] = draft.slots
    .filter((s) => s.isLocal)
    .map((s) => ({ tempId: s.id, slot: s }));

  const toDelete: string[] = [];
  for (const s of server.slots) {
    if (!draftById.has(s.id)) toDelete.push(s.id);
  }

  const toUpdate: SaveDiff['toUpdate'] = [];
  for (const draftSlot of draft.slots) {
    if (draftSlot.isLocal) continue;
    const before = serverById.get(draftSlot.id);
    if (!before) continue;
    const patch: Partial<ClockSlot> = {};
    if (draftSlot.slotType !== before.slotType) patch.slotType = draftSlot.slotType;
    if ((draftSlot.categoryId ?? null) !== (before.categoryId ?? null)) {
      patch.categoryId = draftSlot.categoryId ?? null;
    }
    if (draftSlot.durationEstimateMs !== before.durationEstimateMs) {
      patch.durationEstimateMs = draftSlot.durationEstimateMs;
    }
    if ((draftSlot.rulesJson ?? null) !== (before.rulesJson ?? null)) {
      patch.rulesJson = draftSlot.rulesJson ?? null;
    }
    if (Object.keys(patch).length > 0) {
      toUpdate.push({ id: draftSlot.id, patch });
    }
  }

  const finalOrder: SaveDiff['finalOrder'] = draft.slots.map((s, i) => ({
    id: s.id,
    position: i,
    isLocal: Boolean(s.isLocal),
  }));

  return { metadataPatch: metaPatch, toAdd, toDelete, toUpdate, finalOrder };
}

function isDirty(server: ClockDetail | undefined, draft: DraftState | null): boolean {
  if (!server || !draft) return false;
  const diff = computeSaveDiff(server, draft);
  return (
    diff.metadataPatch !== null ||
    diff.toAdd.length > 0 ||
    diff.toDelete.length > 0 ||
    diff.toUpdate.length > 0 ||
    diff.finalOrder.some((o, i) => server.slots[i]?.id !== o.id)
  );
}

export function ClockBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const id = typeof params?.id === 'string' ? params.id : params?.id?.[0];

  const query = useClock(id);
  const updateClock = useUpdateClock();
  const deleteClock = useDeleteClock();
  const addSlot = useAddSlot();
  const updateSlot = useUpdateSlot();
  const deleteSlotMut = useDeleteSlot();
  const reorderSlots = useReorderSlots();

  // `draftOverride` holds the user's edits in progress. When null, we render
  // the server-sourced state — that's our "saved / clean" view. Setting it
  // back to null after a save or discard syncs to whatever the query last
  // returned.
  const [draftOverride, setDraftOverride] = useState<DraftState | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset on clock id change.
  useEffect(() => {
    setDraftOverride(null);
  }, [id]);

  const draft = useMemo<DraftState | null>(() => {
    if (draftOverride) return draftOverride;
    if (query.data) return fromServer(query.data);
    return null;
  }, [draftOverride, query.data]);

  const setDraft = useCallback(
    (updater: DraftState | ((prev: DraftState) => DraftState) | null) => {
      if (updater === null) {
        setDraftOverride(null);
        return;
      }
      setDraftOverride((prev) => {
        const current = prev ?? (query.data ? fromServer(query.data) : null);
        if (!current) return prev;
        return typeof updater === 'function' ? updater(current) : updater;
      });
    },
    [query.data],
  );

  const dirty = useMemo(
    () => isDirty(query.data, draftOverride),
    [query.data, draftOverride],
  );

  const handleAddSlot = useCallback(
    (slotType: ClockSlotType) => {
      setDraft((prev) => {
        const tempId = `local-${crypto.randomUUID()}`;
        const newSlot: ClockCanvasSlot = {
          id: tempId,
          position: prev.slots.length,
          slotType,
          categoryId: null,
          durationEstimateMs: DEFAULT_SLOT_DURATION_MS,
          rulesJson: null,
          isLocal: true,
        };
        return { ...prev, slots: [...prev.slots, newSlot] };
      });
    },
    [setDraft],
  );

  const handleRemoveSlot = useCallback(
    (slotId: string) => {
      setDraft((prev) => ({
        ...prev,
        slots: prev.slots
          .filter((s) => s.id !== slotId)
          .map((s, i) => ({ ...s, position: i })),
      }));
    },
    [setDraft],
  );

  const handleUpdateSlot = useCallback(
    (slotId: string, patch: Partial<ClockSlot>) => {
      setDraft((prev) => ({
        ...prev,
        slots: prev.slots.map((s) => (s.id === slotId ? { ...s, ...patch } : s)),
      }));
    },
    [setDraft],
  );

  const handleReorder = useCallback(
    (next: ClockCanvasSlot[]) => {
      setDraft((prev) => ({ ...prev, slots: next }));
    },
    [setDraft],
  );

  const handleNameChange = useCallback(
    (next: string) => setDraft((prev) => ({ ...prev, name: next })),
    [setDraft],
  );

  const handleColorChange = useCallback(
    (next: string) => setDraft((prev) => ({ ...prev, color: next })),
    [setDraft],
  );

  const handleTargetMinutesChange = useCallback(
    (minutes: number) => {
      setDraft((prev) => ({
        ...prev,
        targetDurationMs: Math.max(0, Math.round(minutes * 60_000)),
      }));
    },
    [setDraft],
  );

  const handleDiscard = useCallback(() => {
    setDraft(null);
    toast.message(t('clocks.discard'));
  }, [setDraft, t]);

  const handleSave = useCallback(async () => {
    if (!query.data || !draft || !id) return;
    setSaving(true);
    try {
      const diff = computeSaveDiff(query.data, draft);

      // 1. Metadata patch first.
      if (diff.metadataPatch) {
        await updateClock.mutateAsync({ id, ...diff.metadataPatch });
      }

      // 2. Delete removed slots.
      for (const slotId of diff.toDelete) {
        await deleteSlotMut.mutateAsync({ clockId: id, slotId });
      }

      // 3. Update existing slots in place (in current draft position).
      for (const upd of diff.toUpdate) {
        await updateSlot.mutateAsync({ clockId: id, slotId: upd.id, ...upd.patch });
      }

      // 4. Add new slots. Map tempId → real id.
      const tempToReal = new Map<string, string>();
      for (const { tempId, slot } of diff.toAdd) {
        const created = await addSlot.mutateAsync({
          clockId: id,
          position: slot.position,
          slotType: slot.slotType,
          categoryId: slot.categoryId,
          durationEstimateMs: slot.durationEstimateMs,
          rulesJson: slot.rulesJson,
        });
        tempToReal.set(tempId, created.slot.id);
      }

      // 5. Reorder, using real ids, only if there's a meaningful reorder.
      const resolvedOrder = diff.finalOrder.map((o) => ({
        id: o.isLocal ? tempToReal.get(o.id) ?? o.id : o.id,
        position: o.position,
      }));
      const orderChanged = resolvedOrder.some((o, i) => query.data?.slots[i]?.id !== o.id);
      if (orderChanged && resolvedOrder.length > 0) {
        await reorderSlots.mutateAsync({ clockId: id, order: resolvedOrder });
      }

      toast.success(t('clocks.saved'));
      // Reset draft — next render will sync from refetched query.data.
      setDraftOverride(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [
    query.data,
    draft,
    id,
    updateClock,
    deleteSlotMut,
    updateSlot,
    addSlot,
    reorderSlots,
    t,
  ]);

  const handleDelete = useCallback(() => {
    if (!id) return;
    deleteClock.mutate(id, {
      onSuccess: () => {
        toast.success(t('clocks.saved'));
        router.push('/app/clocks');
      },
      onError: (err) => toast.error(err.message),
    });
  }, [id, deleteClock, router, t]);

  if (!id) {
    return (
      <div className="app-page">
        <EmptyState
          title={t('clocks.emptyState.title')}
          description={t('clocks.emptyState.description')}
          action={{
            label: t('clocks.emptyState.action'),
            onClick: () => router.push('/app/clocks'),
          }}
        />
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="app-page space-y-3">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data || !draft) {
    return (
      <div className="app-page">
        <EmptyState
          title={t('clocks.emptyState.title')}
          description={t('clocks.emptyState.description')}
          action={{
            label: t('clocks.emptyState.action'),
            onClick: () => router.push('/app/clocks'),
          }}
        />
      </div>
    );
  }

  const targetMinutes = Math.round(draft.targetDurationMs / 60_000);

  return (
    <div className="app-page space-y-4">
      <header
        data-testid="builder-header"
        className="flex flex-wrap items-center gap-3 rounded-xl border border-border surface-1 p-3"
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/app/clocks')}
          aria-label="Back"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Input
          data-testid="builder-name"
          value={draft.name}
          onChange={(e) => handleNameChange(e.currentTarget.value)}
          placeholder={t('clocks.untitledClock')}
          className="h-9 max-w-sm text-base font-semibold"
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Color</span>
          <input
            data-testid="builder-color"
            type="color"
            value={draft.color}
            onChange={(e) => handleColorChange(e.currentTarget.value)}
            className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent"
          />
        </label>
        <div className="flex items-center gap-2">
          <Label
            htmlFor="builder-target"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            {t('clocks.totalDuration', { minutes: targetMinutes })}
          </Label>
          <Input
            id="builder-target"
            data-testid="builder-target"
            type="number"
            min={1}
            step={1}
            value={targetMinutes}
            onChange={(e) => handleTargetMinutesChange(Number(e.currentTarget.value) || 0)}
            className="h-8 w-20"
          />
        </div>

        <div className="flex-1" />

        <span
          data-testid="builder-dirty-indicator"
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            dirty
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
          )}
        >
          {dirty ? t('clocks.dirty') : t('clocks.saved')}
          {!dirty && <CheckCircle2 className="size-3" />}
        </span>

        <Button
          data-testid="builder-discard"
          variant="ghost"
          onClick={handleDiscard}
          disabled={!dirty || saving}
        >
          <Undo2 className="mr-1 size-4" />
          {t('clocks.discard')}
        </Button>
        <Button
          data-testid="builder-save"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
        >
          {saving ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Save className="mr-1 size-4" />}
          {t('clocks.save')}
        </Button>
        <Button
          data-testid="builder-delete"
          variant="ghost"
          onClick={() => setDeleteOpen(true)}
          aria-label={t('clocks.delete')}
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr_280px]">
        <ClockSlotPalette onAddSlot={handleAddSlot} />
        <ClockCanvas
          slots={draft.slots}
          onAddSlot={handleAddSlot}
          onRemove={handleRemoveSlot}
          onReorder={handleReorder}
          onUpdateSlot={handleUpdateSlot}
        />
        <ClockLivePreview slots={draft.slots} targetDurationMs={draft.targetDurationMs} />
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent data-testid="builder-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('clocks.delete')}</AlertDialogTitle>
            <AlertDialogDescription>{t('clocks.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('clocks.discard')}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="builder-delete-confirm"
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('clocks.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default ClockBuilderPage;
