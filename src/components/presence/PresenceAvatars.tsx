'use client';

/**
 * Phase 6.1 — presence avatar stack.
 *
 * Renders a small stack of up to `max` circular avatars (default 5) for the
 * users currently looking at one polymorphic target (a clock, a schedule
 * cell, a voice track, etc.). The viewer themself is filtered out before
 * stacking — they don't need to see their own avatar.
 *
 * Initials + background colour are derived deterministically from `userId`
 * so re-renders don't flicker. If the active count exceeds `max`, an
 * extra "+N more" pill is appended.
 *
 * Data comes from `usePresenceFor`, which polls every 5s via REST. There
 * is no WebSocket / Durable Object dependency (deferred to Phase 6.2).
 */

import { useTranslation } from 'react-i18next';
import {
  usePresenceFor,
  type PresenceSession,
  type PresenceTarget,
} from '@/lib/presence-queries';

export interface PresenceAvatarsProps {
  target: PresenceTarget;
  /** UserId of the viewer; their session is hidden from the stack. */
  currentUserId: string | null;
  /** Maximum number of avatars rendered before collapsing to "+N more". */
  max?: number;
  className?: string;
}

/**
 * Pull initials from a username, falling back to userId. Empty / missing
 * inputs yield a single "?" so the avatar circle never collapses.
 */
export function deriveInitials(
  username: string | null | undefined,
  userId: string,
): string {
  const source = (username && username.trim().length > 0 ? username : userId).trim();
  if (!source) return '?';
  const parts = source.split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Map a userId to one of a fixed palette of accessible chip colours. The
 * hash is intentionally tiny (sum-of-char-codes) but stable across renders
 * and across users — same id, same colour.
 */
export const PRESENCE_AVATAR_PALETTE = [
  '#3b82f6', // blue-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#a855f7', // purple-500
  '#ef4444', // red-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
  '#84cc16', // lime-500
] as const;

export function deriveAvatarColor(userId: string): string {
  if (!userId) return PRESENCE_AVATAR_PALETTE[0];
  let acc = 0;
  for (let i = 0; i < userId.length; i += 1) {
    acc = (acc + userId.charCodeAt(i)) >>> 0;
  }
  return PRESENCE_AVATAR_PALETTE[acc % PRESENCE_AVATAR_PALETTE.length];
}

export function PresenceAvatars({
  target,
  currentUserId,
  max = 5,
  className,
}: PresenceAvatarsProps) {
  const { t } = useTranslation();
  const query = usePresenceFor(target);

  const sessions: PresenceSession[] = query.data?.sessions ?? [];
  const others = sessions.filter((s) => s.userId !== currentUserId);

  if (others.length === 0) {
    return null;
  }

  const visible = others.slice(0, max);
  const overflow = others.length - visible.length;

  return (
    <div
      className={[
        'flex items-center -space-x-2',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="presence-avatars"
      data-target-type={target.type}
      data-target-id={target.id}
      aria-label={t('presence.avatars.ariaLabel', {
        count: others.length,
        defaultValue: '{{count}} people viewing',
      })}
    >
      {visible.map((session) => {
        const label = session.username ?? session.userId;
        return (
          <span
            key={session.id}
            data-testid="presence-avatar"
            data-user-id={session.userId}
            title={label}
            aria-label={label}
            style={{ backgroundColor: deriveAvatarColor(session.userId) }}
            className="inline-flex h-7 w-7 select-none items-center justify-center rounded-full border-2 border-background text-xs font-semibold text-white shadow-sm"
          >
            {deriveInitials(session.username, session.userId)}
          </span>
        );
      })}
      {overflow > 0 ? (
        <span
          data-testid="presence-overflow"
          title={t('presence.avatars.overflowTitle', {
            count: overflow,
            defaultValue: '{{count}} more people',
          })}
          className="inline-flex h-7 min-w-[1.75rem] select-none items-center justify-center rounded-full border-2 border-background bg-muted px-1 text-xs font-semibold text-muted-foreground shadow-sm"
        >
          {t('presence.avatars.overflow', {
            count: overflow,
            defaultValue: '+{{count}}',
          })}
        </span>
      ) : null}
    </div>
  );
}
