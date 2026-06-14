"use client";

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ClockSlot } from '@/lib/clock-queries';
import { SLOT_TYPE_META } from './ClockSlotPalette';

export interface ClockLivePreviewProps {
  slots: ClockSlot[];
  /** Target duration in ms (typically 3_600_000 for a 60-minute clock). */
  targetDurationMs: number;
}

/**
 * Compute totals + drift for the preview. Pure — exported for direct testing.
 */
export interface PreviewSummary {
  totalMs: number;
  totalMinutes: number;
  targetMinutes: number;
  driftMs: number;
  status: 'on-target' | 'overflow' | 'underflow';
}

export function summarisePreview(
  slots: ClockSlot[],
  targetDurationMs: number,
): PreviewSummary {
  const totalMs = slots.reduce(
    (acc, s) => acc + Math.max(0, s.durationEstimateMs ?? 0),
    0,
  );
  const driftMs = totalMs - targetDurationMs;
  let status: PreviewSummary['status'];
  // Treat "within 30s" of target as on-target — slight rounding tolerance.
  if (Math.abs(driftMs) < 30_000) {
    status = 'on-target';
  } else if (driftMs > 0) {
    status = 'overflow';
  } else {
    status = 'underflow';
  }
  return {
    totalMs,
    totalMinutes: Math.round(totalMs / 60_000),
    targetMinutes: Math.round(targetDurationMs / 60_000),
    driftMs,
    status,
  };
}

function formatSeconds(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ClockLivePreview({ slots, targetDurationMs }: ClockLivePreviewProps) {
  const { t } = useTranslation();
  const summary = useMemo(
    () => summarisePreview(slots, targetDurationMs),
    [slots, targetDurationMs],
  );

  // Bar segments. Use the max of total and target as the denominator so the
  // bar never grows beyond the visible width even on overflow — the overflow
  // bit is rendered as a separate red sliver after target.
  const denominator = Math.max(summary.totalMs, targetDurationMs, 1);

  return (
    <aside
      data-testid="clock-live-preview"
      className="rounded-xl border border-border surface-1 p-3 space-y-3"
    >
      <h2 className="text-sm font-semibold text-foreground">{t('clocks.preview.title')}</h2>

      <div className="space-y-1">
        <div
          data-testid="preview-bar"
          className="flex h-3 w-full overflow-hidden rounded-full bg-secondary"
        >
          {slots.map((slot, idx) => {
            const pct = (Math.max(0, slot.durationEstimateMs ?? 0) / denominator) * 100;
            if (pct <= 0) return null;
            const meta = SLOT_TYPE_META[slot.slotType];
            return (
              <span
                key={`${slot.id}-${idx}`}
                data-testid={`preview-segment-${slot.id}`}
                title={`${meta ? slot.slotType : 'unknown'} • ${formatSeconds(slot.durationEstimateMs)}`}
                style={{ width: `${pct}%` }}
                className={cn('h-full first:rounded-l-full last:rounded-r-full border-r border-background/50', meta?.className)}
              />
            );
          })}
        </div>

        <p
          data-testid="preview-status"
          className={cn(
            'text-xs font-medium',
            summary.status === 'on-target' && 'text-emerald-600 dark:text-emerald-300',
            summary.status === 'overflow' && 'text-rose-600 dark:text-rose-300',
            summary.status === 'underflow' && 'text-amber-600 dark:text-amber-300',
          )}
        >
          {summary.status === 'on-target' &&
            t('clocks.preview.estimated', {
              minutes: summary.totalMinutes,
              target: summary.targetMinutes,
            })}
          {summary.status === 'overflow' &&
            t('clocks.preview.overflow', {
              minutes: Math.round(summary.driftMs / 60_000),
            })}
          {summary.status === 'underflow' &&
            t('clocks.preview.underflow', {
              minutes: Math.round(Math.abs(summary.driftMs) / 60_000),
            })}
        </p>
      </div>

      <ul data-testid="preview-list" className="space-y-1 text-xs">
        {slots.length === 0 ? (
          <li className="italic text-muted-foreground">—</li>
        ) : (
          slots.map((slot, i) => {
            const meta = SLOT_TYPE_META[slot.slotType];
            return (
              <li
                key={`${slot.id}-${i}`}
                data-testid={`preview-row-${slot.id}`}
                className="flex items-center justify-between gap-2"
              >
                <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', meta?.className)}>
                  {t(`clocks.slotPalette.${slot.slotType}`)}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {formatSeconds(slot.durationEstimateMs)}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}

export default ClockLivePreview;
