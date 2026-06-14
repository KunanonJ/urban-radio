/** Calendar window for the queue Gantt: Day = 24h, Week = Mon–Sun, Month = calendar month, Quarter = fiscal quarter (3 calendar months). */

export type GanttScale = 'day' | 'week' | 'month' | 'quarter';

export type GanttWindowBounds = {
  start: Date;
  end: Date;
  windowSec: number;
};

export function getGanttWindowBounds(scale: GanttScale, now = new Date()): GanttWindowBounds {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay();

  if (scale === 'day') {
    const start = new Date(y, m, d, 0, 0, 0, 0);
    const end = new Date(y, m, d + 1, 0, 0, 0, 0);
    return { start, end, windowSec: 86400 };
  }

  if (scale === 'week') {
    const mondayOffset = (dow + 6) % 7;
    const start = new Date(y, m, d - mondayOffset, 0, 0, 0, 0);
    const end = new Date(start.getTime() + 7 * 86400000);
    return { start, end, windowSec: 7 * 86400 };
  }

  if (scale === 'quarter') {
    const qStartMonth = Math.floor(m / 3) * 3;
    const start = new Date(y, qStartMonth, 1, 0, 0, 0, 0);
    const end = new Date(y, qStartMonth + 3, 1, 0, 0, 0, 0);
    const windowSec = Math.round((end.getTime() - start.getTime()) / 1000);
    return { start, end, windowSec };
  }

  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const end = new Date(y, m + 1, 1, 0, 0, 0, 0);
  const windowSec = Math.round((end.getTime() - start.getTime()) / 1000);
  return { start, end, windowSec };
}

export type GanttBarSegmentInput = {
  durationSec: number;
};

export type GanttBarScaledItem = GanttBarSegmentInput & { displaySec: number };

export type GanttBarLayout = {
  start: Date;
  end: Date;
  windowSec: number;
  beforeSec: number;
  afterSec: number;
  scaledItems: GanttBarScaledItem[];
  /** When queue is longer than remaining window, segments are scaled down to fit. */
  scaleFactor: number;
};

/** Move the calendar window one step for Prev/Next (day / week / month / quarter). */
export function shiftGanttWindowAnchor(scale: GanttScale, anchor: Date, dir: -1 | 1): Date {
  const d = new Date(anchor.getTime());
  if (scale === 'day') {
    d.setDate(d.getDate() + dir);
    return d;
  }
  if (scale === 'week') {
    d.setDate(d.getDate() + dir * 7);
    return d;
  }
  if (scale === 'month') {
    d.setMonth(d.getMonth() + dir);
    return d;
  }
  d.setMonth(d.getMonth() + dir * 3);
  return d;
}

export type ComputeGanttBarLayoutOptions = {
  /** Which calendar period to show. Defaults to `playbackNow` (current behaviour). */
  windowAnchorDate?: Date;
};

/**
 * Maps queue segments onto [window start … window end]: time already elapsed in the window,
 * then the queue (scaled if it would overflow), then the rest of the window.
 *
 * @param playbackNow — real "now" for the playhead / red line inside the window.
 */
export function computeGanttBarLayout(
  scale: GanttScale,
  playbackNow: Date,
  segments: GanttBarSegmentInput[],
  totalQueueSec: number,
  options?: ComputeGanttBarLayoutOptions,
): GanttBarLayout {
  const anchor = options?.windowAnchorDate ?? playbackNow;
  const { start, end, windowSec } = getGanttWindowBounds(scale, anchor);
  const nowMs = playbackNow.getTime();
  const nowOffsetSec = Math.max(0, Math.min(windowSec, (nowMs - start.getTime()) / 1000));
  const availableForQueue = Math.max(0, windowSec - nowOffsetSec);
  const queueTotalSec = Math.max(0, totalQueueSec);

  const scaleFactor =
    availableForQueue <= 0
      ? 0
      : queueTotalSec > availableForQueue
        ? availableForQueue / queueTotalSec
        : 1;

  const scaledItems: GanttBarScaledItem[] = segments.map((s) => ({
    ...s,
    displaySec:
      scaleFactor === 0 ? 0 : Math.max(1, Math.round(s.durationSec * scaleFactor)),
  }));

  const queueSpanSec = scaledItems.reduce((a, s) => a + s.displaySec, 0);
  const beforeSec = nowOffsetSec;
  const afterSec = Math.max(0, windowSec - beforeSec - queueSpanSec);

  return { start, end, windowSec, beforeSec, afterSec, scaledItems, scaleFactor };
}
