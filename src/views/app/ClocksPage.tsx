"use client";

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { Clock, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useClocks, useCreateClock, type ClockRow } from '@/lib/clock-queries';

const DEFAULT_COLOR = '#3b82f6';
const DEFAULT_TARGET_MINUTES = 60;

interface CreateClockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (clock: ClockRow) => void;
}

function CreateClockDialog({ open, onOpenChange, onCreated }: CreateClockDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState<number>(DEFAULT_TARGET_MINUTES);
  const create = useCreateClock();

  const reset = useCallback(() => {
    setName('');
    setMinutes(DEFAULT_TARGET_MINUTES);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = name.trim();
      if (trimmed.length === 0 || create.isPending) return;
      const targetDurationMs = Math.max(0, Math.round(minutes * 60_000));
      create.mutate(
        { name: trimmed, color: DEFAULT_COLOR, targetDurationMs },
        {
          onSuccess: ({ clock }) => {
            toast.success(t('clocks.saved'));
            reset();
            onOpenChange(false);
            onCreated(clock);
          },
          onError: (err) => {
            toast.error(err.message);
          },
        },
      );
    },
    [name, minutes, create, t, reset, onOpenChange, onCreated],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent data-testid="clocks-create-dialog">
        <DialogHeader>
          <DialogTitle>{t('clocks.newClock')}</DialogTitle>
          <DialogDescription>{t('clocks.emptyState.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="clock-name">{t('clocks.untitledClock')}</Label>
            <Input
              id="clock-name"
              data-testid="clocks-create-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder={t('clocks.untitledClock')}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="clock-target">
              {t('clocks.totalDuration', { minutes: DEFAULT_TARGET_MINUTES })}
            </Label>
            <Input
              id="clock-target"
              data-testid="clocks-create-minutes"
              type="number"
              min={1}
              step={1}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.currentTarget.value) || 0)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              {t('clocks.discard')}
            </Button>
            <Button
              type="submit"
              data-testid="clocks-create-submit"
              disabled={name.trim().length === 0 || create.isPending}
            >
              {t('clocks.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ClockCardProps {
  clock: ClockRow;
}

function ClockCard({ clock }: ClockCardProps) {
  const { t } = useTranslation();
  const minutes = Math.round((clock.targetDurationMs ?? 3600000) / 60_000);
  return (
    <Link
      href={`/app/clocks/${encodeURIComponent(clock.id)}`}
      data-testid={`clocks-card-${clock.id}`}
      className="block overflow-hidden rounded-xl border border-border surface-1 transition-colors hover:border-primary/40 hover:bg-secondary/40"
    >
      <div
        aria-hidden
        className="h-1 w-full"
        style={{ background: clock.color || '#3b82f6' }}
      />
      <div className="space-y-1 p-4">
        <h3 className="truncate text-base font-semibold text-foreground">
          {clock.name || t('clocks.untitledClock')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('clocks.totalDuration', { minutes })}
        </p>
      </div>
    </Link>
  );
}

export function ClocksPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useClocks();
  const [createOpen, setCreateOpen] = useState(false);

  const clocks = useMemo(() => data?.clocks ?? [], [data]);

  const openCreate = useCallback(() => setCreateOpen(true), []);

  const handleCreated = useCallback(
    (clock: ClockRow) => {
      router.push(`/app/clocks/${encodeURIComponent(clock.id)}`);
    },
    [router],
  );

  if (isLoading) {
    return (
      <div className="app-page space-y-4">
        <div className="flex items-center gap-3">
          <Clock className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">{t('clocks.title')}</h1>
        </div>
        <div data-testid="clocks-loading" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="app-page space-y-4">
        <div className="flex items-center gap-3">
          <Clock className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">{t('clocks.title')}</h1>
        </div>
        <EmptyState
          title={t('clocks.emptyState.title')}
          description={t('clocks.emptyState.description')}
          icon={Clock}
          action={{ label: t('clocks.emptyState.action'), onClick: () => void refetch() }}
        />
      </div>
    );
  }

  return (
    <div className="app-page space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <Clock className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold text-foreground">{t('clocks.title')}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('clocks.subtitle')}</p>
        </div>
        <Button data-testid="clocks-new-button" onClick={openCreate}>
          <Plus className="mr-1 size-4" />
          {t('clocks.newClock')}
        </Button>
      </header>

      {clocks.length === 0 ? (
        <EmptyState
          title={t('clocks.emptyState.title')}
          description={t('clocks.emptyState.description')}
          icon={Clock}
          action={{ label: t('clocks.emptyState.action'), onClick: openCreate }}
        />
      ) : (
        <div
          data-testid="clocks-grid"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {clocks.map((c) => (
            <ClockCard key={c.id} clock={c} />
          ))}
        </div>
      )}

      <CreateClockDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />
    </div>
  );
}

export default ClocksPage;
