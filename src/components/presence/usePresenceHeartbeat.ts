'use client';

/**
 * Phase 6.1 — heartbeat side-effect hook.
 *
 * Drop this into any component that wants to claim presence on one
 * polymorphic target. It fires `POST /api/presence/heartbeat` immediately
 * on mount and then every 5s while the component stays mounted. On unmount
 * the interval is cleared.
 *
 * The mutation hydrates the `usePresenceFor` cache for the same target so a
 * sibling `<PresenceAvatars />` updates in the same round-trip without
 * waiting for its own poll tick.
 *
 * No WebSocket, no Durable Object — REST polling only. Real-time push and
 * CRDT edit locks are deferred to Phase 6.2.
 */

import { useEffect } from 'react';
import {
  PRESENCE_HEARTBEAT_INTERVAL_MS,
  useSendPresenceHeartbeat,
  type PresenceTarget,
} from '@/lib/presence-queries';

export interface UsePresenceHeartbeatOptions {
  target: PresenceTarget;
  /**
   * When false, the hook is inert (no mount beacon, no interval). Useful
   * for components that conditionally claim presence — e.g. only when the
   * builder is in an "open" state.
   */
  enabled?: boolean;
  /**
   * Override the default 5s interval. Mostly used by tests; production
   * code should leave this at the default to keep timing predictable.
   */
  intervalMs?: number;
}

export function usePresenceHeartbeat({
  target,
  enabled = true,
  intervalMs = PRESENCE_HEARTBEAT_INTERVAL_MS,
}: UsePresenceHeartbeatOptions): void {
  const heartbeat = useSendPresenceHeartbeat();

  useEffect(() => {
    if (!enabled) return;
    if (!target.id) return;

    const send = (): void => {
      heartbeat.mutate({ targetType: target.type, targetId: target.id });
    };

    // Mount beacon — claim presence immediately so other viewers can see us
    // before the first poll tick on their side.
    send();

    const timer = setInterval(send, intervalMs);
    return () => {
      clearInterval(timer);
    };
    // We intentionally do not depend on `heartbeat`; the mutation hook is
    // stable across renders. Adding it would loop on every successful
    // mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, intervalMs, target.id, target.type]);
}
