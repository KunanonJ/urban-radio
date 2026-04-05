import { autoFill } from '@/lib/scheduling/auto-fill-engine';
import type { AutoFillInput, AutoFillResult } from '@/lib/scheduling/types';

/**
 * Client-side rundown generation.
 * Pre-fetches all data and passes it to the pure auto-fill engine.
 * This avoids the need for a server-side API route in v1.
 */
export function generateRundown(input: AutoFillInput): AutoFillResult {
  return autoFill(input);
}
