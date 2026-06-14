"use client";

import { Fragment, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { FileClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { AuditLogDiff } from './AuditLogDiff';
import type { AuditLogEntry } from '@/lib/audit-log-queries';

export interface AuditLogListProps {
  entries: AuditLogEntry[];
  isLoading: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  className?: string;
}

function formatAt(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  // Local-time friendly with seconds — auditing needs precision.
  return format(d, 'PPpp');
}

function actionVariant(action: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  // Map common action verbs to badge tones.
  if (action === 'delete') return 'destructive';
  if (action === 'create') return 'default';
  if (action === 'update' || action === 'reorder') return 'secondary';
  return 'outline';
}

/**
 * Tabular view of audit_log entries with an expandable "details" row that
 * mounts an <AuditLogDiff /> inside the table for the selected row.
 *
 * Loading state renders skeleton rows; empty state delegates to the shared
 * EmptyState component. The list itself is "dumb" — pagination/refetch is
 * the parent's responsibility via the `onLoadMore` prop.
 */
export function AuditLogList({
  entries,
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  className,
}: AuditLogListProps) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpanded = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const skeletonRows = useMemo(() => Array.from({ length: 6 }, (_, i) => i), []);

  if (isLoading) {
    return (
      <div data-testid="audit-log-list-loading" className={`space-y-2 ${className ?? ''}`}>
        {skeletonRows.map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        title={t('auditLog.empty.title')}
        description={t('auditLog.empty.description')}
        icon={FileClock}
      />
    );
  }

  return (
    <div
      data-testid="audit-log-list"
      className={`overflow-hidden rounded-xl border border-border ${className ?? ''}`}
    >
      <table className="w-full text-sm">
        <thead className="surface-2 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">{t('auditLog.list.at')}</th>
            <th className="px-3 py-2 text-left">{t('auditLog.list.actor')}</th>
            <th className="px-3 py-2 text-left">{t('auditLog.list.action')}</th>
            <th className="px-3 py-2 text-left">{t('auditLog.list.target')}</th>
            <th className="px-3 py-2 text-right">{t('auditLog.list.details')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const actorLabel =
              entry.actor.username ?? entry.actor.userId ?? '(deleted user)';
            const isExpanded = expandedId === entry.id;
            return (
              <Fragment key={entry.id}>
                <tr
                  data-testid={`audit-log-row-${entry.id}`}
                  className="border-t border-border hover:bg-secondary/40"
                >
                  <td className="px-3 py-2 align-top whitespace-nowrap text-xs text-muted-foreground">
                    {formatAt(entry.at)}
                  </td>
                  <td className="px-3 py-2 align-top">{actorLabel}</td>
                  <td className="px-3 py-2 align-top">
                    <Badge variant={actionVariant(entry.action)} className="text-[10px]">
                      {entry.action}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="text-xs text-muted-foreground">{entry.targetType}</span>
                    <span className="mx-1 text-muted-foreground">·</span>
                    <span className="font-mono text-xs">{entry.targetId}</span>
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid={`audit-log-expand-${entry.id}`}
                      onClick={() => toggleExpanded(entry.id)}
                    >
                      {isExpanded ? 'Hide' : 'View'}
                    </Button>
                  </td>
                </tr>
                {isExpanded ? (
                  <tr
                    data-testid={`audit-log-detail-${entry.id}`}
                    className="border-t border-border bg-secondary/20"
                  >
                    <td colSpan={5} className="px-3 py-3">
                      <AuditLogDiff before={entry.before} after={entry.after} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {hasNextPage ? (
        <div className="flex justify-center border-t border-border surface-2 px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="audit-log-load-more"
            disabled={Boolean(isFetchingNextPage)}
            onClick={onLoadMore}
          >
            {isFetchingNextPage ? '…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
