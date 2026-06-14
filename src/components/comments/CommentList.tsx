'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, Pencil, Trash2, Undo2, X, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  useDeleteComment,
  useUpdateComment,
  type CommentRow,
} from '@/lib/comment-queries';

interface CommentListProps {
  comments: CommentRow[];
  currentUserId: string | null;
  currentUserRole: string | null;
  className?: string;
}

const ROLES_THAT_CAN_RESOLVE = new Set(['admin', 'producer']);
const ROLES_WITH_DELETE_OVERRIDE = new Set(['admin']);
const MAX_LENGTH = 2000;

function safeRelativeTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  try {
    return formatDistanceToNow(parsed, { addSuffix: true });
  } catch {
    return iso;
  }
}

export function CommentList({
  comments,
  currentUserId,
  currentUserRole,
  className,
}: CommentListProps) {
  const { t } = useTranslation();
  const update = useUpdateComment();
  const del = useDeleteComment();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState('');

  if (comments.length === 0) {
    return (
      <div
        className={['flex flex-col items-center justify-center gap-2 rounded-lg border border-border/40 px-6 py-10 text-center', className]
          .filter(Boolean)
          .join(' ')}
      >
        <h3 className="text-sm font-semibold text-foreground">
          {t('comments.empty.title')}
        </h3>
        <p className="text-xs text-muted-foreground">
          {t('comments.empty.description')}
        </p>
      </div>
    );
  }

  return (
    <ul className={['flex flex-col gap-3', className].filter(Boolean).join(' ')}>
      {comments.map((c) => {
        const isAuthor = currentUserId !== null && c.authorUserId === currentUserId;
        const canResolve =
          isAuthor ||
          (currentUserRole !== null && ROLES_THAT_CAN_RESOLVE.has(currentUserRole));
        const canDelete =
          isAuthor ||
          (currentUserRole !== null && ROLES_WITH_DELETE_OVERRIDE.has(currentUserRole));
        const isResolved = Boolean(c.resolvedAt);
        const isEditing = editingId === c.id;

        const startEdit = () => {
          setEditingId(c.id);
          setEditBuf(c.body);
        };
        const cancelEdit = () => {
          setEditingId(null);
          setEditBuf('');
        };
        const saveEdit = () => {
          const trimmed = editBuf.trim();
          if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return;
          update.mutate(
            { id: c.id, patch: { body: editBuf } },
            { onSuccess: () => cancelEdit() },
          );
        };
        const toggleResolve = () => {
          update.mutate({ id: c.id, patch: { resolved: !isResolved } });
        };
        const handleDelete = () => {
          const ok = window.confirm(t('comments.actions.deleteConfirm'));
          if (!ok) return;
          del.mutate(c.id);
        };

        return (
          <li
            key={c.id}
            data-testid="comment-row"
            data-resolved={isResolved ? 'true' : 'false'}
            className={[
              'rounded-lg border border-border/40 bg-card/40 p-3',
              isResolved ? 'opacity-60' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {c.author.username ?? c.author.userId}
              </span>
              <span aria-hidden>·</span>
              <time dateTime={c.createdAt}>{safeRelativeTime(c.createdAt)}</time>
              {isResolved ? (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  {t('comments.resolved')}
                </span>
              ) : null}
            </div>

            {isEditing ? (
              <div className="mt-2 flex flex-col gap-2">
                <Textarea
                  value={editBuf}
                  onChange={(e) => setEditBuf(e.target.value.slice(0, MAX_LENGTH))}
                  rows={3}
                  maxLength={MAX_LENGTH}
                />
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={cancelEdit}
                  >
                    <X className="mr-1 h-3 w-3" />
                    {t('comments.actions.cancel')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={saveEdit}
                    disabled={editBuf.trim().length === 0 || update.isPending}
                  >
                    <Save className="mr-1 h-3 w-3" />
                    {t('comments.actions.save')}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {c.body}
              </p>
            )}

            {!isEditing ? (
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {isAuthor ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={startEdit}
                  >
                    <Pencil className="mr-1 h-3 w-3" />
                    {t('comments.actions.edit')}
                  </Button>
                ) : null}
                {canResolve ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={toggleResolve}
                    disabled={update.isPending}
                  >
                    {isResolved ? (
                      <>
                        <Undo2 className="mr-1 h-3 w-3" />
                        {t('comments.actions.unresolve')}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        {t('comments.actions.resolve')}
                      </>
                    )}
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleDelete}
                    disabled={del.isPending}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    {t('comments.actions.delete')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
