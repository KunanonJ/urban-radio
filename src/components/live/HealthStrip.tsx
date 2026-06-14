'use client';

import { useTranslation } from 'react-i18next';
import { Activity, CalendarClock, Users } from 'lucide-react';

import { useStreamStatus } from '@/lib/stream-status-queries';
import { useSchedulerStore } from '@/lib/scheduler-store';
import { cn } from '@/lib/utils';

/**
 * Encoder pill semantic state.
 *
 * - `streaming`: connected to a real backend (e.g. AzuraCast) → green pill.
 * - `demo`: connected but `source === 'stub'` (no real encoder yet) → amber pill.
 * - `idle`: not connected → muted grey pill.
 * - `connecting`: query in flight, no data yet → amber/spinner.
 * - `error`: query failed → red pill.
 */
type EncoderState = 'streaming' | 'demo' | 'idle' | 'connecting' | 'error';

/**
 * Compact horizontal strip with three status pills:
 *   1. Encoder    — from `useStreamStatus` (polls `/api/stream/status`).
 *   2. Listeners  — listener count from the same status payload.
 *   3. Scheduler  — derived from the local scheduler store; today we only know
 *                   whether any "pause" event is staged (no heartbeat field on
 *                   the store yet, so "active" is the default).
 *
 * All pills carry a `data-state` attribute so tests can assert semantics
 * without pinning Tailwind class names.
 */
export interface HealthStripProps {
  className?: string;
}

const ENCODER_PILL_CLASSES: Record<EncoderState, string> = {
  streaming: 'border-neon-green text-neon-green bg-neon-green/10',
  demo: 'border-neon-amber text-neon-amber bg-neon-amber/10',
  connecting: 'border-neon-amber/60 text-neon-amber bg-neon-amber/5',
  idle: 'border-border text-muted-foreground bg-muted/30',
  error: 'border-destructive text-destructive bg-destructive/10',
};

type SchedulerState = 'active' | 'paused' | 'stale';

const SCHEDULER_PILL_CLASSES: Record<SchedulerState, string> = {
  active: 'border-neon-cyan text-neon-cyan bg-neon-cyan/10',
  paused: 'border-neon-amber text-neon-amber bg-neon-amber/10',
  stale: 'border-destructive text-destructive bg-destructive/10',
};

const SCHEDULER_LABEL_KEYS: Record<SchedulerState, string> = {
  active: 'liveStudio.health.schedulerActive',
  paused: 'liveStudio.health.schedulerPaused',
  stale: 'liveStudio.health.schedulerHeartbeatStale',
};

function deriveEncoderState(
  data: { status: { connected: boolean; source: string } } | undefined,
  isLoading: boolean,
  isError: boolean,
): EncoderState {
  if (isError) return 'error';
  if (!data) return isLoading ? 'connecting' : 'idle';
  if (!data.status.connected) return 'idle';
  if (data.status.source === 'stub') return 'demo';
  return 'streaming';
}

function encoderLabelKey(state: EncoderState): string {
  switch (state) {
    case 'streaming':
      return 'liveStudio.health.encoderStreaming';
    case 'demo':
      return 'liveStudio.health.encoderDemo';
    case 'connecting':
      return 'liveStudio.health.encoderConnecting';
    case 'error':
      return 'liveStudio.health.encoderError';
    case 'idle':
    default:
      return 'liveStudio.health.encoderIdle';
  }
}

export function HealthStrip({ className }: HealthStripProps = {}) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useStreamStatus();
  const events = useSchedulerStore((s) => s.events);

  const encoderState = deriveEncoderState(data, isLoading, isError);
  const listeners = data?.status.listeners ?? 0;

  // Scheduler heartbeat is not tracked on the store yet (no `lastFired` field).
  // We expose the two states we *can* derive today: "paused" when a pause event
  // is staged (the scheduler is configured to pause at some point), "active"
  // otherwise. "Stale" is reserved for the future heartbeat check — the union
  // and class map below leave room for it without churning the API surface.
  const hasPauseEvent = events.some((e) => e.action === 'pause');
  const schedulerState: SchedulerState = hasPauseEvent ? 'paused' : 'active';
  const schedulerLabelKey: string = SCHEDULER_LABEL_KEYS[schedulerState];

  return (
    <section
      aria-label={t('liveStudio.health.title')}
      data-testid="health-strip"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2',
        className,
      )}
    >
      <span
        data-testid="health-encoder-pill"
        data-state={encoderState}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-mono uppercase tracking-wider',
          ENCODER_PILL_CLASSES[encoderState],
        )}
      >
        <Activity className="h-3 w-3" aria-hidden="true" />
        {t(encoderLabelKey(encoderState))}
      </span>

      <span
        data-testid="health-listeners-pill"
        data-state="listeners"
        data-listeners={listeners}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[11px] font-mono uppercase tracking-wider text-foreground',
        )}
      >
        <Users className="h-3 w-3" aria-hidden="true" />
        {t('liveStudio.health.listeners', { count: listeners })}
      </span>

      <span
        data-testid="health-scheduler-pill"
        data-state={schedulerState}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-mono uppercase tracking-wider',
          SCHEDULER_PILL_CLASSES[schedulerState],
        )}
      >
        <CalendarClock className="h-3 w-3" aria-hidden="true" />
        {t(schedulerLabelKey)}
      </span>
    </section>
  );
}
