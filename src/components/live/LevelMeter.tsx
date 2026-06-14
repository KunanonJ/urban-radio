'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { amplitudeToDb, readPeak, type PeakSample } from '@/lib/audio-graph';
import { cn } from '@/lib/utils';

export interface LevelMeterProps {
  analyser: AnalyserNode | null;
  label?: string;
  /** Default is 'vertical'. */
  orientation?: 'horizontal' | 'vertical';
  /** Used in tests to bypass requestAnimationFrame. */
  rafImpl?: (cb: FrameRequestCallback) => number;
  /** Used in tests to bypass cancelAnimationFrame. */
  cancelRafImpl?: (id: number) => void;
}

/** Peak hold decay rate in dB per second. */
const PEAK_HOLD_DECAY_DBPS = 12;

/**
 * Map a peak amplitude (0..1) to a color tier:
 * - red    ≥ -6 dBFS  (amp ≥ ~0.501)
 * - yellow ≥ -12 dBFS (amp ≥ ~0.251)
 * - green  otherwise
 */
function colorTierForAmp(amp: number): 'red' | 'yellow' | 'green' {
  const db = amplitudeToDb(amp);
  if (db >= -6) return 'red';
  if (db >= -12) return 'yellow';
  return 'green';
}

function tierClass(tier: 'red' | 'yellow' | 'green'): string {
  if (tier === 'red') return 'bg-red-500';
  if (tier === 'yellow') return 'bg-yellow-400';
  return 'bg-green-500';
}

interface MeterBarProps {
  amp: number;
  peakHold: number;
  orientation: 'horizontal' | 'vertical';
  label: string;
}

function MeterBar({ amp, peakHold, orientation, label }: MeterBarProps) {
  const tier = colorTierForAmp(amp);
  const percent = Math.min(100, Math.max(0, amp * 100));
  const holdPercent = Math.min(100, Math.max(0, peakHold * 100));
  const isVertical = orientation === 'vertical';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-sm bg-muted/40',
        isVertical ? 'h-full w-3' : 'h-3 w-full',
      )}
      data-testid={`meter-bar-${label.toLowerCase()}`}
      aria-label={label}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number(amp.toFixed(3))}
    >
      <div
        className={cn(
          'absolute transition-[width,height] duration-75',
          tierClass(tier),
          isVertical ? 'bottom-0 left-0 w-full' : 'left-0 top-0 h-full',
        )}
        style={
          isVertical
            ? { height: `${percent}%` }
            : { width: `${percent}%` }
        }
        data-testid={`meter-fill-${label.toLowerCase()}`}
      />
      {peakHold > 0.001 && (
        <div
          className={cn(
            'absolute bg-foreground/80',
            isVertical ? 'left-0 h-[2px] w-full' : 'top-0 w-[2px] h-full',
          )}
          style={
            isVertical
              ? { bottom: `calc(${holdPercent}% - 1px)` }
              : { left: `calc(${holdPercent}% - 1px)` }
          }
          data-testid={`meter-peak-hold-${label.toLowerCase()}`}
        />
      )}
    </div>
  );
}

/**
 * LevelMeter — renders two thin bars (L + R) reflecting an AnalyserNode's
 * instantaneous peak amplitude. Includes a peak-hold indicator per bar that
 * decays at ~12 dB/sec.
 *
 * When `analyser` is null, renders a muted, disabled state.
 */
export function LevelMeter({
  analyser,
  label,
  orientation = 'vertical',
  rafImpl,
  cancelRafImpl,
}: LevelMeterProps) {
  const { t } = useTranslation();
  const [sample, setSample] = useState<PeakSample>({ left: 0, right: 0, peak: 0 });
  const [holdLeft, setHoldLeft] = useState(0);
  const [holdRight, setHoldRight] = useState(0);
  const lastTickRef = useRef<number>(0);
  const holdLeftRef = useRef(0);
  const holdRightRef = useRef(0);

  useEffect(() => {
    if (!analyser) return;
    const raf = rafImpl ?? requestAnimationFrame.bind(window);
    const cancel = cancelRafImpl ?? cancelAnimationFrame.bind(window);
    let frame = 0;
    let cancelled = false;

    const tick = (timeMs: number) => {
      if (cancelled) return;
      const next = readPeak(analyser);
      setSample(next);

      const last = lastTickRef.current;
      const dt = last === 0 ? 1 / 60 : Math.max(0, (timeMs - last) / 1000);
      lastTickRef.current = timeMs;

      // Decay: 12 dB/sec → amplitude factor per tick = 10^(-12*dt/20).
      const decayFactor = Math.pow(10, (-PEAK_HOLD_DECAY_DBPS * dt) / 20);
      holdLeftRef.current = Math.max(next.left, holdLeftRef.current * decayFactor);
      holdRightRef.current = Math.max(next.right, holdRightRef.current * decayFactor);
      setHoldLeft(holdLeftRef.current);
      setHoldRight(holdRightRef.current);

      frame = raf(tick);
    };

    frame = raf(tick);
    return () => {
      cancelled = true;
      cancel(frame);
    };
  }, [analyser, rafImpl, cancelRafImpl]);

  const disabled = analyser === null;
  const headerLabel = label ?? t('liveStudio.meters.title');
  const isVertical = orientation === 'vertical';

  return (
    <div
      className={cn(
        'flex flex-col gap-1',
        disabled && 'opacity-50',
      )}
      data-testid="level-meter"
      data-orientation={orientation}
      data-disabled={disabled ? 'true' : 'false'}
    >
      {label !== '' && (
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {headerLabel}
        </div>
      )}
      <div
        className={cn(
          'flex gap-1',
          isVertical ? 'h-24 flex-row items-stretch' : 'h-auto w-full flex-col',
        )}
      >
        <MeterBar
          amp={disabled ? 0 : sample.left}
          peakHold={disabled ? 0 : holdLeft}
          orientation={orientation}
          label={t('liveStudio.meters.left')}
        />
        <MeterBar
          amp={disabled ? 0 : sample.right}
          peakHold={disabled ? 0 : holdRight}
          orientation={orientation}
          label={t('liveStudio.meters.right')}
        />
      </div>
    </div>
  );
}
