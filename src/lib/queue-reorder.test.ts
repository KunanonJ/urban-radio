import { describe, expect, it } from 'vitest';
import { arrayMove } from '@dnd-kit/sortable';
import { newQueueIndexAfterMove } from './queue-reorder';

function assertCurrentTrackStays(
  queue: { id: string }[],
  queueIndex: number,
  from: number,
  to: number,
) {
  const before = queue[queueIndex];
  const next = arrayMove(queue, from, to);
  const nextIdx = newQueueIndexAfterMove(queueIndex, from, to);
  expect(next[nextIdx]).toBe(before);
}

describe('newQueueIndexAfterMove', () => {
  it('moves current index when dragging the current row', () => {
    expect(newQueueIndexAfterMove(2, 2, 0)).toBe(0);
    expect(newQueueIndexAfterMove(1, 1, 3)).toBe(3);
  });

  it('shifts index when current sits in the shifted range (move first toward end)', () => {
    expect(newQueueIndexAfterMove(2, 0, 2)).toBe(1);
  });

  it('shifts index when current is before moved range', () => {
    expect(newQueueIndexAfterMove(1, 3, 0)).toBe(2);
  });

  it('leaves index unchanged when current is outside affected range', () => {
    expect(newQueueIndexAfterMove(0, 2, 3)).toBe(0);
    expect(newQueueIndexAfterMove(4, 1, 2)).toBe(4);
  });
});

describe('newQueueIndexAfterMove + arrayMove (reference)', () => {
  it('keeps the same current track object after reorder', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    const c = { id: 'c' };
    const d = { id: 'd' };
    const queue = [a, b, c, d];
    assertCurrentTrackStays(queue, 1, 3, 0);
    assertCurrentTrackStays(queue, 0, 0, 2);
    assertCurrentTrackStays(queue, 2, 1, 3);
  });
});
