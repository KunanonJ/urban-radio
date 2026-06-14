import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Mock i18n so tests don't depend on the locale loader.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'presence.avatars.ariaLabel': `${vars?.count ?? 0} people viewing`,
        'presence.avatars.overflowTitle': `${vars?.count ?? 0} more people`,
        'presence.avatars.overflow': `+${vars?.count ?? 0}`,
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

let sessionsToReturn: import('@/lib/presence-queries').PresenceSession[] = [];

vi.mock('@/lib/presence-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/presence-queries')>(
    '@/lib/presence-queries',
  );
  return {
    ...actual,
    usePresenceFor: () => ({
      data: { sessions: sessionsToReturn, meta: { ttlSeconds: 15 } },
      isLoading: false,
      isFetching: false,
      error: null,
    }),
  };
});

import {
  PresenceAvatars,
  deriveAvatarColor,
  deriveInitials,
  PRESENCE_AVATAR_PALETTE,
} from './PresenceAvatars';

(globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLDivElement;
  root: Root;
}

function render(element: ReactNode): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return { container, root };
}

function cleanup({ container, root }: Rendered) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

const rendered: Rendered[] = [];

const makeSession = (
  partial: Partial<import('@/lib/presence-queries').PresenceSession>,
): import('@/lib/presence-queries').PresenceSession => ({
  id: partial.id ?? `p-${Math.random()}`,
  userId: partial.userId ?? 'user-x',
  username: partial.username ?? null,
  targetType: partial.targetType ?? 'clock',
  targetId: partial.targetId ?? 'clk-1',
  lastHeartbeatAt: partial.lastHeartbeatAt ?? '2026-05-14T10:00:00Z',
  createdAt: partial.createdAt ?? '2026-05-14T10:00:00Z',
});

beforeEach(() => {
  sessionsToReturn = [];
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

describe('deriveInitials', () => {
  test('returns first+last initials from a multi-part username', () => {
    expect(deriveInitials('Alex Producer', 'u-1')).toBe('AP');
  });

  test('returns first 2 chars of a single-word username', () => {
    expect(deriveInitials('demo', 'u-1')).toBe('DE');
  });

  test('handles snake_case / kebab-case', () => {
    expect(deriveInitials('alex_producer', 'u-1')).toBe('AP');
    expect(deriveInitials('alex-producer', 'u-1')).toBe('AP');
  });

  test('falls back to userId when username is null/empty', () => {
    // userId 'user-1' splits on '-' → ['user','1'] → first+last initials = 'U1'.
    expect(deriveInitials(null, 'user-1')).toBe('U1');
    expect(deriveInitials('', 'user-1')).toBe('U1');
    // Single-token fallback uses the first two chars uppercased.
    expect(deriveInitials(null, 'demo')).toBe('DE');
  });

  test('returns "?" if both username and userId are blank', () => {
    expect(deriveInitials(null, '')).toBe('?');
  });
});

describe('deriveAvatarColor', () => {
  test('returns a value from the palette', () => {
    const color = deriveAvatarColor('user-1');
    expect(PRESENCE_AVATAR_PALETTE).toContain(color);
  });

  test('is deterministic for the same userId', () => {
    expect(deriveAvatarColor('user-7')).toBe(deriveAvatarColor('user-7'));
  });

  test('falls back to first palette color on empty userId', () => {
    expect(deriveAvatarColor('')).toBe(PRESENCE_AVATAR_PALETTE[0]);
  });
});

describe('PresenceAvatars', () => {
  test('renders nothing when no other sessions are active', () => {
    sessionsToReturn = [];
    const r = render(
      <PresenceAvatars
        target={{ type: 'clock', id: 'clk-1' }}
        currentUserId="me"
      />,
    );
    rendered.push(r);
    expect(r.container.querySelector('[data-testid="presence-avatars"]')).toBeNull();
  });

  test('filters out the current user from the stack', () => {
    sessionsToReturn = [
      makeSession({ id: 'p-1', userId: 'me', username: 'self' }),
      makeSession({ id: 'p-2', userId: 'other', username: 'someone' }),
    ];
    const r = render(
      <PresenceAvatars
        target={{ type: 'clock', id: 'clk-1' }}
        currentUserId="me"
      />,
    );
    rendered.push(r);
    const chips = r.container.querySelectorAll(
      '[data-testid="presence-avatar"]',
    );
    expect(chips.length).toBe(1);
    expect((chips[0] as HTMLElement).dataset.userId).toBe('other');
  });

  test('renders initials + deterministic color + tooltip per active user', () => {
    sessionsToReturn = [
      makeSession({ id: 'p-1', userId: 'user-1', username: 'Alex Producer' }),
    ];
    const r = render(
      <PresenceAvatars
        target={{ type: 'clock', id: 'clk-1' }}
        currentUserId="me"
      />,
    );
    rendered.push(r);
    const chip = r.container.querySelector(
      '[data-testid="presence-avatar"]',
    ) as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('AP');
    expect(chip.getAttribute('title')).toBe('Alex Producer');
    // Inline style sets backgroundColor to a palette colour.
    const bg = chip.style.backgroundColor;
    expect(bg).not.toBe('');
  });

  test('shows "+N more" overflow when active count exceeds max', () => {
    sessionsToReturn = Array.from({ length: 8 }, (_, i) =>
      makeSession({ id: `p-${i}`, userId: `user-${i}`, username: `u${i}` }),
    );
    const r = render(
      <PresenceAvatars
        target={{ type: 'clock', id: 'clk-1' }}
        currentUserId="me"
        max={3}
      />,
    );
    rendered.push(r);
    const chips = r.container.querySelectorAll(
      '[data-testid="presence-avatar"]',
    );
    expect(chips.length).toBe(3);
    const overflow = r.container.querySelector(
      '[data-testid="presence-overflow"]',
    );
    expect(overflow).not.toBeNull();
    expect(overflow!.textContent).toContain('+5');
  });

  test('emits data-target-type / data-target-id on the container', () => {
    sessionsToReturn = [
      makeSession({ id: 'p-1', userId: 'user-1', username: 'demo' }),
    ];
    const r = render(
      <PresenceAvatars
        target={{ type: 'schedule_cell', id: 'cell-9' }}
        currentUserId="me"
      />,
    );
    rendered.push(r);
    const container = r.container.querySelector(
      '[data-testid="presence-avatars"]',
    ) as HTMLElement;
    expect(container.dataset.targetType).toBe('schedule_cell');
    expect(container.dataset.targetId).toBe('cell-9');
  });
});
