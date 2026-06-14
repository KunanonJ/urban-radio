'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useComments,
  type CommentRow,
  type CommentTargetType,
} from '@/lib/comment-queries';
import { CommentComposer } from './CommentComposer';
import { CommentList } from './CommentList';

interface CommentThreadProps {
  targetType: CommentTargetType;
  targetId: string;
  /**
   * The current viewer. Used to decide which row actions to render
   * (`useUpdateComment` / `useDeleteComment` will also enforce on the server).
   */
  currentUserId: string | null;
  /** Station role of the viewer, used for the resolve/delete role gates. */
  currentUserRole: string | null;
  /** Override the section heading. Defaults to the `comments.title` i18n key. */
  title?: string;
  className?: string;
}

export function CommentThread({
  targetType,
  targetId,
  currentUserId,
  currentUserRole,
  title,
  className,
}: CommentThreadProps) {
  const { t } = useTranslation();
  const [includeResolved, setIncludeResolved] = useState(false);

  const query = useComments(
    { type: targetType, id: targetId },
    { includeResolved },
  );

  const comments: CommentRow[] = (query.data?.pages ?? []).flatMap(
    (p) => p.comments,
  );

  const headerLabel = title ?? t('comments.title');

  return (
    <section
      className={['flex flex-col gap-3', className].filter(Boolean).join(' ')}
      data-testid="comment-thread"
      data-target-type={targetType}
      data-target-id={targetId}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{headerLabel}</h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setIncludeResolved((v) => !v)}
        >
          {includeResolved ? (
            <>
              <EyeOff className="mr-1 h-3 w-3" />
              {t('comments.hideResolved')}
            </>
          ) : (
            <>
              <Eye className="mr-1 h-3 w-3" />
              {t('comments.showResolved')}
            </>
          )}
        </Button>
      </header>

      <CommentComposer targetType={targetType} targetId={targetId} />

      <CommentList
        comments={comments}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
      />
    </section>
  );
}
