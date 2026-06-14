/** Max automatic reload+play attempts per incident (exponential backoff). */
export const MAX_RECOVERY_ATTEMPTS = 5;

/** Base delay before first retry (ms). */
export const BASE_RETRY_MS = 500;

export function recoveryBackoffMs(attemptIndex: number): number {
  return BASE_RETRY_MS * Math.pow(2, Math.min(attemptIndex, 4));
}
