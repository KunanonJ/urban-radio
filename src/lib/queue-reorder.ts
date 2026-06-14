/**
 * After moving one element from `from` to `to` in an array, compute the new index
 * of the element that was at `oldQueueIndex` before the move.
 */
export function newQueueIndexAfterMove(oldQueueIndex: number, from: number, to: number): number {
  if (oldQueueIndex === from) return to;
  if (from < to) {
    if (oldQueueIndex > from && oldQueueIndex <= to) return oldQueueIndex - 1;
  } else if (from > to) {
    if (oldQueueIndex >= to && oldQueueIndex < from) return oldQueueIndex + 1;
  }
  return oldQueueIndex;
}
