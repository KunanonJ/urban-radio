import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import React, { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'comments.title': 'Comments',
        'comments.showResolved': 'Show resolved',
        'comments.hideResolved': 'Hide resolved',
        'comments.compose.placeholder': 'Leave a comment…',
        'comments.compose.submit': 'Comment',
        'comments.compose.charCount': `${vars?.count ?? 0} / 2000`,
        'comments.actions.edit': 'Edit',
        'comments.actions.delete': 'Delete',
        'comments.actions.resolve': 'Mark resolved',
        'comments.actions.unresolve': 'Unresolve',
        'comments.resolved': 'Resolved',
        'comments.empty.title': 'No comments yet',
        'comments.empty.description': 'Start the conversation.',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

const useCommentsArgs: { lastOpts?: { includeResolved?: boolean } } = {};
let commentsToReturn: import('@/lib/comment-queries').CommentRow[] = [];

vi.mock('@/lib/comment-queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/comment-queries')>(
    '@/lib/comment-queries',
  );
  return {
    ...actual,
    useComments: (
      _t: { type: string; id: string },
      opts: { includeResolved?: boolean } = {},
    ) => {
      useCommentsArgs.lastOpts = opts;
      return {
        data: {
          pages: [
            {
              comments: commentsToReturn,
              meta: { nextCursor: null, limit: 50 },
            },
          ],
          pageParams: [null],
        },
        isLoading: false,
        isFetching: false,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
        isFetchingNextPage: false,
      };
    },
    useCreateComment: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(() => Promise.resolve({ comment: {} })),
      isPending: false,
    }),
    useUpdateComment: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(() => Promise.resolve({ comment: {} })),
      isPending: false,
    }),
    useDeleteComment: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(() => Promise.resolve()),
      isPending: false,
    }),
  };
});

import { CommentThread } from './CommentThread';
import type { CommentRow } from '@/lib/comment-queries';

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

const openComment: CommentRow = {
  id: 'c-1',
  stationId: 's',
  authorUserId: 'u-1',
  targetType: 'clock',
  targetId: 'clk-1',
  body: 'I love this clock',
  resolvedAt: null,
  resolvedByUserId: null,
  createdAt: '2026-05-14T10:00:00Z',
  updatedAt: '2026-05-14T10:00:00Z',
  author: { userId: 'u-1', username: 'demo' },
};

beforeEach(() => {
  useCommentsArgs.lastOpts = undefined;
  commentsToReturn = [];
});

afterEach(() => {
  while (rendered.length > 0) {
    const r = rendered.pop();
    if (r) cleanup(r);
  }
});

function findButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
  return buttons.find((b) => (b.textContent ?? '').includes(text)) ?? null;
}

describe('CommentThread', () => {
  test('renders header title, composer, and list', () => {
    commentsToReturn = [openComment];
    const r = render(
      <CommentThread
        targetType="clock"
        targetId="clk-1"
        currentUserId="u-1"
        currentUserRole="admin"
      />,
    );
    rendered.push(r);
    expect(r.container.textContent).toContain('Comments');
    expect(r.container.textContent).toContain('I love this clock');
    expect(r.container.querySelector('textarea')).not.toBeNull();
  });

  test('renders empty state when there are no comments', () => {
    commentsToReturn = [];
    const r = render(
      <CommentThread
        targetType="clock"
        targetId="clk-1"
        currentUserId="u-1"
        currentUserRole="admin"
      />,
    );
    rendered.push(r);
    expect(r.container.textContent).toContain('No comments yet');
  });

  test('toggle Show resolved flips the includeResolved flag passed to useComments', () => {
    commentsToReturn = [];
    const r = render(
      <CommentThread
        targetType="clock"
        targetId="clk-1"
        currentUserId="u-1"
        currentUserRole="admin"
      />,
    );
    rendered.push(r);
    // Initial state: hide resolved
    expect(useCommentsArgs.lastOpts?.includeResolved).not.toBe(true);
    const toggle = findButtonByText(r.container, 'Show resolved');
    expect(toggle).not.toBeNull();
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useCommentsArgs.lastOpts?.includeResolved).toBe(true);
    expect(findButtonByText(r.container, 'Hide resolved')).not.toBeNull();
  });

  test('honors custom title prop', () => {
    commentsToReturn = [];
    const r = render(
      <CommentThread
        targetType="clock"
        targetId="clk-1"
        currentUserId="u-1"
        currentUserRole="admin"
        title="Notes"
      />,
    );
    rendered.push(r);
    expect(r.container.textContent).toContain('Notes');
  });
});
