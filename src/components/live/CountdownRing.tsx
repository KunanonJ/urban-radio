'use client';

import { cn } from '@/lib/utils';

interface CountdownRingProps {
  /** Progress 0..1. Matches `usePlayerStore.progress`. */
  progress: number;
  /** Total pixel size of the SVG; default 120. */
  size?: number;
  /** Stroke width in px; default 8. */
  strokeWidth?: number;
  /** Optional remaining-time label rendered in the middle (e.g. "1:23"). */
  remainingLabel?: string;
  className?: string;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Circular SVG progress ring.
 *
 * Renders an empty ring at progress 0 (full dashoffset = circumference)
 * and a filled ring at progress 1 (dashoffset = 0).
 * The big remaining time label sits in the middle.
 */
export function CountdownRing({
  progress,
  size = 120,
  strokeWidth = 8,
  remainingLabel,
  className,
}: CountdownRingProps) {
  const safeProgress = clamp01(progress);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // 0 progress -> full circumference offset (empty); 1 progress -> 0 offset (full).
  const dashOffset = circumference * (1 - safeProgress);
  const center = size / 2;

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      data-testid="countdown-ring"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        className="block"
      >
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={strokeWidth}
        />
        {/* Progress arc — rotates so 0 progress starts at the top */}
        <circle
          data-testid="countdown-ring-progress"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: 'stroke-dashoffset 200ms linear' }}
        />
      </svg>
      {remainingLabel ? (
        <span
          data-testid="countdown-ring-label"
          className="absolute inset-0 flex items-center justify-center text-2xl font-semibold tabular-nums"
        >
          {remainingLabel}
        </span>
      ) : null}
    </div>
  );
}

export default CountdownRing;
