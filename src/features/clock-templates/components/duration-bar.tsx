'use client';

import type { ClockSegment } from '@/types';
import { totalSegmentDuration } from '@/lib/validators/clock-template.schema';

const SEGMENT_COLORS: Record<string, string> = {
  song: 'bg-blue-500',
  ad_break: 'bg-amber-500',
  jingle: 'bg-purple-500',
  news: 'bg-emerald-500',
  talk_break: 'bg-cyan-500',
  promo: 'bg-pink-500',
  filler: 'bg-gray-400',
};

interface DurationBarProps {
  readonly segments: readonly ClockSegment[];
  readonly maxSec?: number;
}

export function DurationBar({ segments, maxSec = 3600 }: DurationBarProps) {
  const total = totalSegmentDuration(segments);
  const overflow = total > maxSec;

  return (
    <div className="space-y-1">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((seg) => {
          const pct = (seg.targetDurationSec / maxSec) * 100;
          return (
            <div
              key={seg.id}
              className={`${SEGMENT_COLORS[seg.type] ?? 'bg-gray-400'} transition-all`}
              style={{ width: `${Math.min(pct, 100)}%` }}
              title={`${seg.label}: ${seg.targetDurationSec}s`}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatDuration(total)}</span>
        <span className={overflow ? 'font-semibold text-destructive' : ''}>
          {overflow ? `+${total - maxSec}s overflow` : `${maxSec - total}s remaining`}
        </span>
      </div>
    </div>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
