import { describe, expect, it } from 'vitest';
import { computeGanttBarLayout, getGanttWindowBounds, shiftGanttWindowAnchor } from './gantt-timeline';

describe('shiftGanttWindowAnchor', () => {
  it('moves calendar day by one for day scale', () => {
    const a = new Date(2026, 3, 10, 12, 0, 0);
    expect(shiftGanttWindowAnchor('day', a, -1).getDate()).toBe(9);
    expect(shiftGanttWindowAnchor('day', a, 1).getDate()).toBe(11);
  });

  it('moves by 7 days for week scale', () => {
    const a = new Date(2026, 3, 10, 12, 0, 0);
    const next = shiftGanttWindowAnchor('week', a, 1);
    expect(next.getTime() - a.getTime()).toBe(7 * 86400000);
  });

  it('moves by one month for month scale', () => {
    const a = new Date(2026, 3, 10, 12, 0, 0);
    const next = shiftGanttWindowAnchor('month', a, 1);
    expect(next.getMonth()).toBe(4);
  });

  it('moves by three months for quarter scale', () => {
    const a = new Date(2026, 0, 10, 12, 0, 0);
    const next = shiftGanttWindowAnchor('quarter', a, 1);
    expect(next.getMonth()).toBe(3);
  });
});

describe('computeGanttBarLayout', () => {
  it('matches legacy behaviour when windowAnchorDate is omitted', () => {
    const now = new Date(2026, 3, 10, 12, 0, 0);
    const a = computeGanttBarLayout('day', now, [{ durationSec: 100 }], 100);
    const b = computeGanttBarLayout('day', now, [{ durationSec: 100 }], 100, { windowAnchorDate: now });
    expect(a.windowSec).toBe(b.windowSec);
    expect(a.beforeSec).toBe(b.beforeSec);
  });

  it('uses windowAnchorDate for bounds and playbackNow for playhead position', () => {
    const playbackNow = new Date(2026, 3, 10, 15, 0, 0, 0);
    const anchor = new Date(2026, 3, 10, 0, 0, 0, 0);
    const layout = computeGanttBarLayout('day', playbackNow, [{ durationSec: 60 }], 60, {
      windowAnchorDate: anchor,
    });
    const bounds = getGanttWindowBounds('day', anchor);
    expect(layout.start.getTime()).toBe(bounds.start.getTime());
    expect(layout.beforeSec).toBe(15 * 3600);
  });
});
