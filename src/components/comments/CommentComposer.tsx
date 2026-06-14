'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  useCreateComment,
  type CommentTargetType,
} from '@/lib/comment-queries';

interface CommentComposerProps {
  targetType: CommentTargetType;
  targetId: string;
  /**
   * Fired after a successful submission. Use to clear "showing resolved" or
   * scroll to the bottom of the list.
   */
  onSubmitted?: () => void;
  className?: string;
}

const MAX_LENGTH = 2000;

export function CommentComposer({
  targetType,
  targetId,
  onSubmitted,
  className,
}: CommentComposerProps) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const create = useCreateComment();

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_LENGTH && !create.isPending;

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    try {
      await create.mutateAsync({
        targetType,
        targetId,
        body,
      });
      setBody('');
      onSubmitted?.();
    } catch {
      // Errors surface via the mutation state. Keep the textarea content so
      // the user can retry without retyping.
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Cmd+Enter (macOS) and Ctrl+Enter (Windows/Linux) submit.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={['flex flex-col gap-2', className].filter(Boolean).join(' ')}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_LENGTH))}
        onKeyDown={handleKeyDown}
        placeholder={t('comments.compose.placeholder')}
        aria-label={t('comments.compose.placeholder')}
        rows={3}
        maxLength={MAX_LENGTH}
        className="resize-y min-h-[3rem]"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span aria-live="polite">
          {t('comments.compose.charCount', { count: trimmed.length })}
        </span>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {t('comments.compose.submit')}
        </Button>
      </div>
    </form>
  );
}
